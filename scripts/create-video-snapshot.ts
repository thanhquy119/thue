import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readdir, readFile} from "node:fs/promises";
import {rmSync} from "node:fs";
import path from "node:path";
import {addBundleToSandbox, createSandbox} from "@remotion/vercel";
import {put, r2Configured} from "@/lib/storage/r2-blob-compat";
import {readR2Object} from "@/lib/video/r2-media";
import {videoSnapshotKey} from "@/lib/video/remotion-renderer";

const bundleDir = ".remotion-video";
const sandboxBundleDir = "/vercel/sandbox/remotion-bundle";
const enabled = process.env.VIDEO_EXPERIMENT_ENABLED === "true" || process.env.VERCEL_ENV !== "production";
const decoder = new TextDecoder();

if (!enabled) {
  console.log("[video-snapshot] Bỏ qua vì VIDEO_EXPERIMENT_ENABLED chưa bật trên production.");
  process.exit(0);
}

if (!r2Configured()) {
  console.log("[video-snapshot] Bỏ qua vì R2 chưa được cấu hình đầy đủ.");
  process.exit(0);
}

async function bundleHash(directory: string) {
  const hash = createHash("sha256");
  async function visit(current: string) {
    const entries = await readdir(current, {withFileTypes: true});
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(directory, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        hash.update(`dir:${relative}\0`);
        await visit(absolute);
      } else {
        hash.update(`file:${relative}\0`);
        hash.update(await readFile(absolute));
        hash.update("\0");
      }
    }
  }
  await visit(directory);
  return hash.digest("hex");
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

  const hash = await bundleHash(bundleDir);
  const reusableKey = `legal-video/snapshots/by-bundle/${hash}.json`;
  const reusableSnapshotId = await readSnapshot(reusableKey);
  if (reusableSnapshotId) {
    await writeSnapshot(videoSnapshotKey(), {
      snapshotId: reusableSnapshotId,
      bundleHash: hash,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
      reused: true,
      createdAt: new Date().toISOString(),
    });
    console.log(`[video-snapshot] Tái sử dụng snapshot ${reusableSnapshotId} cho bundle ${hash.slice(0, 12)}.`);
    process.exit(0);
  }

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
      bundleHash: hash,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
      reused: false,
      createdAt: new Date().toISOString(),
    };
    await Promise.all([
      writeSnapshot(reusableKey, payload),
      writeSnapshot(videoSnapshotKey(), payload),
    ]);
    console.log(`[video-snapshot] Đã lưu snapshot ${snapshot.snapshotId} vào R2.`);
  } catch (error) {
    await sandbox.stop().catch(() => undefined);
    throw error;
  }
} finally {
  rmSync(bundleDir, {recursive: true, force: true});
}
