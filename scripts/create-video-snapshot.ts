import {execFileSync} from "node:child_process";
import {rmSync} from "node:fs";
import {addBundleToSandbox, createSandbox} from "@remotion/vercel";
import {put, r2Configured} from "@/lib/storage/r2-blob-compat";
import {videoSnapshotKey} from "@/lib/video/remotion-renderer";

const bundleDir = ".remotion-video";
const enabled = process.env.VIDEO_EXPERIMENT_ENABLED === "true" || process.env.VERCEL_ENV !== "production";

if (!enabled) {
  console.log("[video-snapshot] Bỏ qua vì VIDEO_EXPERIMENT_ENABLED chưa bật trên production.");
  process.exit(0);
}

if (!r2Configured()) {
  console.log("[video-snapshot] Bỏ qua vì R2 chưa được cấu hình đầy đủ.");
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
    await addBundleToSandbox({sandbox, bundleDir});

    console.log("[video-snapshot] Đang tạo snapshot không hết hạn…");
    const snapshot = await sandbox.snapshot({expiration: 0});
    await put(
      videoSnapshotKey(),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
        createdAt: new Date().toISOString(),
      }),
      {
        access: "private",
        contentType: "application/json; charset=utf-8",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 0,
      },
    );
    console.log(`[video-snapshot] Đã lưu snapshot ${snapshot.snapshotId} vào R2.`);
  } catch (error) {
    await sandbox.stop().catch(() => undefined);
    throw error;
  }
} finally {
  rmSync(bundleDir, {recursive: true, force: true});
}
