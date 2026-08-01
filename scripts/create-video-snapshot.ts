import {execFileSync} from "node:child_process";
import {rmSync} from "node:fs";
import {put} from "@vercel/blob";
import {addBundleToSandbox, createSandbox} from "@remotion/vercel";

const bundleDir = ".remotion-video";
const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();
const enabled = process.env.VIDEO_EXPERIMENT_ENABLED === "true";

function snapshotBlobKey() {
  return `legal-video/snapshots/${process.env.VERCEL_DEPLOYMENT_ID?.trim() || "local"}.json`;
}

if (!enabled) {
  console.log("[video-snapshot] Bỏ qua vì VIDEO_EXPERIMENT_ENABLED chưa bật.");
  process.exit(0);
}

if (!blobToken) {
  console.log("[video-snapshot] Bỏ qua vì project chưa kết nối Vercel Blob.");
  process.exit(0);
}

rmSync(bundleDir, {recursive: true, force: true});

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

console.log("[video-snapshot] Đang đưa bundle vào Sandbox…");
await addBundleToSandbox({sandbox, bundleDir});

console.log("[video-snapshot] Đang tạo snapshot không hết hạn…");
const snapshot = await sandbox.snapshot({expiration: 0});
await put(
  snapshotBlobKey(),
  JSON.stringify({
    snapshotId: snapshot.snapshotId,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
    createdAt: new Date().toISOString(),
  }),
  {
    access: "public",
    token: blobToken,
    contentType: "application/json; charset=utf-8",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  },
);

rmSync(bundleDir, {recursive: true, force: true});
console.log(`[video-snapshot] Đã lưu snapshot ${snapshot.snapshotId}.`);
