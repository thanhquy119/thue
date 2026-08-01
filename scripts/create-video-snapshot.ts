import {execFileSync} from "node:child_process";
import {rmSync} from "node:fs";
import {addBundleToSandbox, createSandbox} from "@remotion/vercel";
import {put, r2Configured} from "@/lib/storage/r2-blob-compat";
import {VIDEO_TEMPLATE_VERSION} from "@/lib/video/chunking";
import {readR2Object} from "@/lib/video/r2-media";
import {videoSnapshotKey} from "@/lib/video/remotion-renderer";

const bundleDir = ".remotion-video";
const sandboxBundleDir = "/vercel/sandbox/remotion-bundle";
const reusableKey = `legal-video/snapshots/by-template/${VIDEO_TEMPLATE_VERSION}.json`;
const enabled = process.env.VIDEO_EXPERIMENT_ENABLED === "true" || process.env.VERCEL_ENV !== "production";
const decoder = new TextDecoder();
const temporarySmokeJobId = "6e3c154f-3390-49d2-8ee3-fb42701e1b75";

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
