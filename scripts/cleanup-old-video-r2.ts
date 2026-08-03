import {del, r2Configured} from "@/lib/storage/r2-blob-compat";

const enabled = process.env.RUN_VIDEO_R2_CLEANUP === "true"
  || /\[video-r2-cleanup\]/iu.test(process.env.VERCEL_GIT_COMMIT_MESSAGE || "");

if (!enabled) {
  console.log("[video-r2-cleanup] Bỏ qua; chỉ chạy với RUN_VIDEO_R2_CLEANUP=true hoặc marker [video-r2-cleanup].");
  process.exit(0);
}

if (process.env.VERCEL_ENV === "production") {
  throw new Error("[video-r2-cleanup] Không cho phép cleanup trên production.");
}

if (!r2Configured()) {
  throw new Error("[video-r2-cleanup] R2 chưa được cấu hình.");
}

// Explicit allowlist: preserve the newly rendered 94/2026/TT-BTC job.
const oldVideoPaths = [
  "legal-video/renders/6e3c154f-3390-49d2-8ee3-fb42701e1b75/89-2026-tt-btc.mp4",
  "legal-video/renders/b2561e56-9a88-4f5c-b441-e206768800c6/94-2026-tt-btc.mp4",
];

await del(oldVideoPaths);
console.log(`[video-r2-cleanup] Đã xoá ${oldVideoPaths.length} MP4 cũ; giữ nguyên job 94 mới.`);
