import {Sandbox} from "@vercel/sandbox";
import {get, put} from "@/lib/storage/r2-blob-compat";
import {
  legalVideoR2Configured,
  R2_MEDIA_CACHE_SECONDS,
} from "./r2-media";
import type {LegalVideoStoryboard} from "./types";

const BUNDLE_URL = "/vercel/sandbox/remotion-bundle";
const RENDER_TIMEOUT_MS = 40 * 60 * 1000;

function compositionId() {
  return process.env.REMOTION_COMPOSITION_ID?.trim() || "LegalVideo";
}

export function videoSnapshotKey() {
  return `legal-video/snapshots/${process.env.VERCEL_DEPLOYMENT_ID?.trim() || "local"}.json`;
}

export function remotionVercelConfigured() {
  return legalVideoR2Configured();
}

async function snapshotId() {
  const configured = process.env.VIDEO_RENDER_SNAPSHOT_ID?.trim();
  if (configured) return configured;
  const snapshot = await get(videoSnapshotKey(), {access: "private", useCache: false});
  if (!snapshot?.stream) {
    throw new Error("Chưa có snapshot Remotion cho deployment hiện tại. Hãy redeploy sau khi cấu hình R2.");
  }
  const payload = await new Response(snapshot.stream).json() as {snapshotId?: unknown};
  if (typeof payload.snapshotId !== "string" || !payload.snapshotId.trim()) {
    throw new Error("Snapshot Remotion trên R2 không hợp lệ.");
  }
  return payload.snapshotId;
}

async function restoreVideoSandbox() {
  if (!remotionVercelConfigured()) throw new Error("R2 chưa được cấu hình cho pipeline Remotion.");
  return Sandbox.create({
    source: {type: "snapshot", snapshotId: await snapshotId()},
    timeout: RENDER_TIMEOUT_MS,
  });
}

function safeSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/đ/giu, "d")
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLocaleLowerCase("vi");
}

function renderConcurrency() {
  const value = Number(process.env.VIDEO_RENDER_CONCURRENCY || 2);
  return Number.isFinite(value) ? Math.max(1, Math.min(4, Math.round(value))) : 2;
}

function renderConfig(input: {
  outputFile: string;
  storyboard: LegalVideoStoryboard;
}) {
  return {
    serveUrl: BUNDLE_URL,
    compositionId: compositionId(),
    inputProps: {storyboard: input.storyboard},
    outputLocation: input.outputFile,
    codec: "h264",
    crf: 22,
    imageFormat: null,
    pixelFormat: null,
    envVariables: {},
    frameRange: null,
    everyNthFrame: 1,
    proResProfile: null,
    chromiumOptions: {},
    scale: 1,
    preferLossless: false,
    enforceAudioTrack: true,
    disallowParallelEncoding: false,
    concurrency: renderConcurrency(),
    metadata: null,
    licenseKey: process.env.REMOTION_LICENSE_KEY?.trim() || null,
    videoBitrate: null,
    audioBitrate: null,
    encodingMaxRate: null,
    encodingBufferSize: null,
    muted: false,
    numberOfGifLoops: null,
    x264Preset: null,
    gopSize: null,
    colorSpace: "default",
    jpegQuality: 80,
    audioCodec: "aac",
    logLevel: "info",
    timeoutInMilliseconds: 30_000,
    forSeamlessAacConcatenation: false,
    separateAudioTo: null,
    hardwareAcceleration: "disable",
    offthreadVideoCacheSizeInBytes: null,
    mediaCacheSizeInBytes: null,
    offthreadVideoThreads: null,
    chromeMode: "headless-shell",
    browserExecutable: null,
    binariesDirectory: null,
    repro: false,
    sampleRate: 48_000,
    vercelBlob: null,
  };
}

export async function startLegalVideoRender(input: {
  jobId: string;
  storyboard: LegalVideoStoryboard;
}) {
  const sandbox = await restoreVideoSandbox();
  const slug = safeSlug(input.storyboard.document.number) || input.jobId;
  const outputFile = `/tmp/${slug}.mp4`;
  const outputPath = `legal-video/renders/${input.jobId}/${slug}.mp4`;
  try {
    const command = await sandbox.runCommand({
      cmd: "node",
      args: ["render-video.mjs", JSON.stringify(renderConfig({outputFile, storyboard: input.storyboard}))],
      detached: true,
    });
    return {
      sandboxId: sandbox.sandboxId,
      commandId: command.cmdId,
      outputFile,
      outputPath,
    };
  } catch (error) {
    await sandbox.stop().catch(() => undefined);
    throw error;
  }
}

function estimatedProgress(startedAt: unknown) {
  const raw = typeof startedAt === "number" ? startedAt : Date.parse(String(startedAt || ""));
  const start = Number.isFinite(raw) ? raw : Date.now();
  const elapsed = Math.max(0, Date.now() - start);
  return Math.max(0.04, Math.min(0.92, elapsed / (12 * 60 * 1000)));
}

function expiredSandbox(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /404|not found|does not exist|expired|stopped/iu.test(message);
}

export async function legalVideoRenderProgress(input: {
  jobId: string;
  sandboxId: string;
  commandId: string;
  outputFile: string;
  outputPath: string;
}) {
  if (!remotionVercelConfigured()) throw new Error("R2 chưa được cấu hình cho pipeline Remotion.");
  let sandbox: Awaited<ReturnType<typeof Sandbox.get>>;
  try {
    sandbox = await Sandbox.get({sandboxId: input.sandboxId});
  } catch (error) {
    if (expiredSandbox(error)) {
      return {stage: "expired" as const, overallProgress: 0, url: null, pathname: null, error: "Sandbox đã hết hạn."};
    }
    throw error;
  }

  const command = await sandbox.getCommand(input.commandId);
  if (command.exitCode === null) {
    return {
      stage: "render-progress" as const,
      overallProgress: estimatedProgress(command.startedAt),
      url: null,
      pathname: null,
      error: null,
    };
  }

  if (command.exitCode !== 0) {
    const [stderr, stdout] = await Promise.all([
      command.stderr().catch(() => ""),
      command.stdout().catch(() => ""),
    ]);
    await sandbox.stop().catch(() => undefined);
    const detail = `${stderr}\n${stdout}`.trim().slice(-2_000);
    return {
      stage: "error" as const,
      overallProgress: 0,
      url: null,
      pathname: null,
      error: detail ? `Render thất bại: ${detail}` : `Render thất bại với mã ${command.exitCode}.`,
    };
  }

  const video = await sandbox.readFileToBuffer({path: input.outputFile});
  if (!video?.byteLength) {
    await sandbox.stop().catch(() => undefined);
    return {
      stage: "error" as const,
      overallProgress: 1,
      url: null,
      pathname: null,
      error: "Remotion hoàn tất nhưng không tạo được tệp MP4.",
    };
  }

  await put(input.outputPath, video, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: R2_MEDIA_CACHE_SECONDS,
    contentType: "video/mp4",
  });
  await sandbox.stop().catch(() => undefined);
  return {
    stage: "done" as const,
    overallProgress: 1,
    url: `/api/videos/jobs/${encodeURIComponent(input.jobId)}/video`,
    pathname: input.outputPath,
    error: null,
  };
}
