import {Sandbox} from "@vercel/sandbox";
import {put} from "@/lib/storage/r2-blob-compat";
import {
  legalVideoR2Configured,
  readR2Object,
  R2_MEDIA_CACHE_SECONDS,
} from "./r2-media";
import type {LegalVideoStoryboard} from "./types";

const BUNDLE_URL = "/vercel/sandbox/remotion-bundle";
const RENDER_TIMEOUT_MS = 40 * 60 * 1000;
const decoder = new TextDecoder();

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
  const snapshot = await readR2Object(videoSnapshotKey());
  if (!snapshot?.byteLength) {
    throw new Error("Chưa có snapshot Remotion cho deployment hiện tại. Hãy redeploy sau khi cấu hình R2.");
  }
  const payload = JSON.parse(decoder.decode(snapshot)) as {snapshotId?: unknown};
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

function renderStateFiles(jobId: string) {
  const safeJobId = jobId.replace(/[^a-z0-9-]/giu, "-");
  return {
    exitFile: `/tmp/legal-video-${safeJobId}.exit`,
    logFile: `/tmp/legal-video-${safeJobId}.log`,
  };
}

function detachedRenderScript() {
  return [
    'rm -f "$2" "$3"',
    'node render-video.mjs "$1" >"$2" 2>&1',
    "code=$?",
    'printf "%s" "$code" >"$3"',
    'exit "$code"',
  ].join("; ");
}

function missingSandboxFile(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /404|not found|no such file|enoent/iu.test(message);
}

async function readOptionalSandboxFile(
  sandbox: Awaited<ReturnType<typeof Sandbox.get>>,
  pathname: string,
) {
  try {
    return await sandbox.readFileToBuffer({path: pathname});
  } catch (error) {
    if (missingSandboxFile(error)) return null;
    throw error;
  }
}

function renderExitCode(bytes: Uint8Array) {
  const raw = decoder.decode(bytes).trim();
  if (!/^\d{1,3}$/u.test(raw)) {
    throw new Error("Tệp trạng thái render trong Sandbox không hợp lệ.");
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error("Mã kết thúc render trong Sandbox không hợp lệ.");
  }
  return value;
}

export async function startLegalVideoRender(input: {
  jobId: string;
  storyboard: LegalVideoStoryboard;
}) {
  const sandbox = await restoreVideoSandbox();
  const slug = safeSlug(input.storyboard.document.number) || input.jobId;
  const outputFile = `/tmp/${slug}.mp4`;
  const outputPath = `legal-video/renders/${input.jobId}/${slug}.mp4`;
  const state = renderStateFiles(input.jobId);
  try {
    const command = await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-lc",
        detachedRenderScript(),
        "legal-video-render",
        JSON.stringify(renderConfig({outputFile, storyboard: input.storyboard})),
        state.logFile,
        state.exitFile,
      ],
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

  const state = renderStateFiles(input.jobId);
  const exitBytes = await readOptionalSandboxFile(sandbox, state.exitFile);
  if (!exitBytes) {
    const command = await sandbox.getCommand(input.commandId);
    return {
      stage: "render-progress" as const,
      overallProgress: estimatedProgress(command.startedAt),
      url: null,
      pathname: null,
      error: null,
    };
  }

  const exitCode = renderExitCode(exitBytes);
  if (exitCode !== 0) {
    const log = await readOptionalSandboxFile(sandbox, state.logFile);
    await sandbox.stop().catch(() => undefined);
    const detail = log ? decoder.decode(log).trim().slice(-2_000) : "";
    return {
      stage: "error" as const,
      overallProgress: 0,
      url: null,
      pathname: null,
      error: detail ? `Render thất bại: ${detail}` : `Render thất bại với mã ${exitCode}.`,
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
