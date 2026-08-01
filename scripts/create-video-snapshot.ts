import {execFileSync} from "node:child_process";
import {rmSync} from "node:fs";
import {setTimeout as delay} from "node:timers/promises";
import {addBundleToSandbox, createSandbox} from "@remotion/vercel";
import {put, r2Configured} from "@/lib/storage/r2-blob-compat";
import {VIDEO_TEMPLATE_VERSION} from "@/lib/video/chunking";
import {
  legalVideoRenderProgress,
  startLegalVideoRender,
  videoSnapshotKey,
} from "@/lib/video/remotion-renderer";
import {
  readR2Object,
  R2_MEDIA_SIGNED_URL_SECONDS,
  signedR2MediaUrl,
} from "@/lib/video/r2-media";
import {
  patchLegalVideoJob,
  readLegalVideoJob,
  readLegalVideoStoryboard,
} from "@/lib/video/store";
import type {LegalVideoStoryboard} from "@/lib/video/types";

const bundleDir = ".remotion-video";
const sandboxBundleDir = "/vercel/sandbox/remotion-bundle";
const reusableKey = `legal-video/snapshots/by-template/${VIDEO_TEMPLATE_VERSION}.json`;
const enabled = process.env.VIDEO_EXPERIMENT_ENABLED === "true" || process.env.VERCEL_ENV !== "production";
const decoder = new TextDecoder();
const temporarySmokeJobId = "6e3c154f-3390-49d2-8ee3-fb42701e1b75";
const renderSmokeEnabled = process.env.RUN_VIDEO_RENDER_SMOKE === "true"
  || /\[video-render-smoke\]/iu.test(process.env.VERCEL_GIT_COMMIT_MESSAGE || "");

if (!enabled) {
  console.log("[video-snapshot] Bỏ qua vì VIDEO_EXPERIMENT_ENABLED chưa bật trên production.");
  process.exit(0);
}

if (!r2Configured()) {
  console.log("[video-snapshot] Bỏ qua vì R2 chưa được cấu hình đầy đủ.");
  process.exit(0);
}

async function reportTemporarySmokeJob() {
  const bytes = await readR2Object(`legal-video/jobs/${temporarySmokeJobId}.json`);
  if (!bytes?.byteLength) {
    console.log(`[video-smoke] Không tìm thấy job ${temporarySmokeJobId}.`);
    return;
  }
  const job = JSON.parse(decoder.decode(bytes)) as {
    status?: unknown;
    progress?: unknown;
    message?: unknown;
    sceneCount?: unknown;
    ttsChunkCount?: unknown;
    completedTtsChunks?: unknown;
    videoUrl?: unknown;
    error?: unknown;
  };
  console.log(`[video-smoke] ${JSON.stringify({
    jobId: temporarySmokeJobId,
    status: job.status,
    progress: job.progress,
    message: job.message,
    sceneCount: job.sceneCount,
    ttsChunkCount: job.ttsChunkCount,
    completedTtsChunks: job.completedTtsChunks,
    videoReady: typeof job.videoUrl === "string" && Boolean(job.videoUrl),
    error: job.error,
  })}`);
}

async function readSnapshot(pathname: string) {
  const bytes = await readR2Object(pathname);
  if (!bytes?.byteLength) return null;
  const value = JSON.parse(decoder.decode(bytes)) as {snapshotId?: unknown};
  return typeof value.snapshotId === "string" && value.snapshotId.trim() ? value.snapshotId : null;
}

async function writeSnapshot(pathname: string, payload: Record<string, unknown>) {
  await put(pathname, JSON.stringify(payload), {
    access: "private",
    contentType: "application/json; charset=utf-8",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

async function refreshStoryboardAudio(storyboard: LegalVideoStoryboard) {
  return {
    ...storyboard,
    scenes: await Promise.all(storyboard.scenes.map(async (scene) => ({
      ...scene,
      audioChunks: await Promise.all((scene.audioChunks ?? []).map(async (chunk) => ({
        ...chunk,
        url: await signedR2MediaUrl(chunk.cacheKey, R2_MEDIA_SIGNED_URL_SECONDS),
      }))),
    }))),
  };
}

async function runTemporaryRenderSmoke() {
  if (!renderSmokeEnabled) {
    console.log("[video-render-smoke] Bỏ qua; thêm [video-render-smoke] vào commit hoặc bật RUN_VIDEO_RENDER_SMOKE.");
    return;
  }

  const job = await readLegalVideoJob(temporarySmokeJobId);
  if (!job?.storyboardPath) {
    throw new Error(`[video-render-smoke] Job ${temporarySmokeJobId} chưa có storyboard trên R2.`);
  }
  const storedStoryboard = await readLegalVideoStoryboard(job.storyboardPath);
  if (!storedStoryboard) {
    throw new Error(`[video-render-smoke] Không đọc được storyboard ${job.storyboardPath} trên R2.`);
  }
  const storyboard = await refreshStoryboardAudio(storedStoryboard);
  const render = await startLegalVideoRender({jobId: job.jobId, storyboard});
  await patchLegalVideoJob(job.jobId, {
    status: "rendering",
    progress: 78,
    message: "Đang chạy lại smoke Remotion bằng tín hiệu trạng thái bền vững…",
    renderSandboxId: render.sandboxId,
    renderCommandId: render.commandId,
    videoPath: render.outputPath,
    videoUrl: null,
    error: null,
  });

  for (let poll = 0; poll < 240; poll += 1) {
    await delay(5_000);
    const progress = await legalVideoRenderProgress({
      jobId: job.jobId,
      sandboxId: render.sandboxId,
      commandId: render.commandId,
      outputFile: render.outputFile,
      outputPath: render.outputPath,
    });
    console.log(`[video-render-smoke] ${JSON.stringify({
      poll: poll + 1,
      stage: progress.stage,
      progress: Math.round(progress.overallProgress * 100),
      error: progress.error,
    })}`);
    if (progress.stage === "error" || progress.stage === "expired") {
      await patchLegalVideoJob(job.jobId, {
        status: "failed",
        message: "Smoke render Remotion thất bại.",
        error: progress.error || "Sandbox không hoàn tất render.",
      });
      throw new Error(progress.error || "[video-render-smoke] Sandbox không hoàn tất render.");
    }
    if (progress.stage === "done" && progress.url && progress.pathname) {
      await patchLegalVideoJob(job.jobId, {
        status: "ready",
        progress: 100,
        message: "Video smoke đã được dựng và lưu trên R2.",
        videoPath: progress.pathname,
        videoUrl: progress.url,
        error: null,
      });
      console.log(`[video-render-smoke] READY ${progress.pathname}`);
      return;
    }
  }

  await patchLegalVideoJob(job.jobId, {
    status: "failed",
    message: "Smoke render Remotion quá thời gian.",
    error: "Quá thời gian chờ Sandbox hoàn tất render.",
  });
  throw new Error("[video-render-smoke] Quá thời gian chờ Sandbox hoàn tất render.");
}

await reportTemporarySmokeJob();

const reusableSnapshotId = await readSnapshot(reusableKey);
if (reusableSnapshotId) {
  await writeSnapshot(videoSnapshotKey(), {
    snapshotId: reusableSnapshotId,
    templateVersion: VIDEO_TEMPLATE_VERSION,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
    reused: true,
    createdAt: new Date().toISOString(),
  });
  console.log(`[video-snapshot] Tái sử dụng snapshot ${reusableSnapshotId} của ${VIDEO_TEMPLATE_VERSION}.`);
  await runTemporaryRenderSmoke();
  process.exit(0);
}

rmSync(bundleDir, {recursive: true, force: true});

try {
  console.log("[video-snapshot] Đang bundle composition LegalVideo…");
  execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "remotion",
      "bundle",
      "experiments/remotion-tt89/src/serverless-index.ts",
      "--out-dir",
      bundleDir,
    ],
    {stdio: "inherit", env: process.env},
  );

  const sandbox = await createSandbox({
    onProgress: ({progress, message}) => {
      console.log(`[video-snapshot] ${message} (${Math.round(progress * 100)}%)`);
    },
  });

  try {
    console.log("[video-snapshot] Đang đưa bundle vào Sandbox…");
    await sandbox.mkDir(sandboxBundleDir);
    await addBundleToSandbox({sandbox, bundleDir});

    console.log("[video-snapshot] Đang tạo snapshot không hết hạn…");
    const snapshot = await sandbox.snapshot({expiration: 0});
    const payload = {
      snapshotId: snapshot.snapshotId,
      templateVersion: VIDEO_TEMPLATE_VERSION,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
      reused: false,
      createdAt: new Date().toISOString(),
    };
    await Promise.all([
      writeSnapshot(reusableKey, payload),
      writeSnapshot(videoSnapshotKey(), payload),
    ]);
    console.log(`[video-snapshot] Đã lưu snapshot ${snapshot.snapshotId} cho ${VIDEO_TEMPLATE_VERSION}.`);
  } catch (error) {
    await sandbox.stop().catch(() => undefined);
    throw error;
  }
} finally {
  rmSync(bundleDir, {recursive: true, force: true});
}

await runTemporaryRenderSmoke();
