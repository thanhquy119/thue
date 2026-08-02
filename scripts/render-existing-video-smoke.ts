import {setTimeout as delay} from "node:timers/promises";
import {r2Configured} from "@/lib/storage/r2-blob-compat";
import {legalVideoRenderProgress, startLegalVideoRender} from "@/lib/video/remotion-renderer";
import {R2_MEDIA_SIGNED_URL_SECONDS, signedR2MediaUrl} from "@/lib/video/r2-media";
import {
  patchLegalVideoJob,
  readLegalVideoJob,
  readLegalVideoStoryboard,
} from "@/lib/video/store";
import type {LegalVideoStoryboard} from "@/lib/video/types";

const enabled = process.env.RUN_VIDEO_EXISTING_RENDER_SMOKE === "true"
  || /\[video-render-existing-smoke\]/iu.test(process.env.VERCEL_GIT_COMMIT_MESSAGE || "");
const jobId = process.env.VIDEO_EXISTING_RENDER_SMOKE_JOB_ID?.trim()
  || "b2561e56-9a88-4f5c-b441-e206768800c6";

if (!enabled) {
  console.log("[video-existing-render-smoke] Bỏ qua; thêm [video-render-existing-smoke] vào commit để chạy.");
  process.exit(0);
}

if (process.env.VERCEL_ENV === "production") {
  console.log("[video-existing-render-smoke] Bỏ qua trên production.");
  process.exit(0);
}

if (!r2Configured()) {
  throw new Error("[video-existing-render-smoke] R2 chưa được cấu hình.");
}

const job = await readLegalVideoJob(jobId);
if (!job?.storyboardPath) {
  throw new Error(`[video-existing-render-smoke] Job ${jobId} chưa có storyboard trên R2.`);
}

const storedStoryboard = await readLegalVideoStoryboard(job.storyboardPath);
if (!storedStoryboard) {
  throw new Error(`[video-existing-render-smoke] Không đọc được storyboard ${job.storyboardPath}.`);
}

const storyboard: LegalVideoStoryboard = {
  ...storedStoryboard,
  scenes: await Promise.all(storedStoryboard.scenes.map(async (scene) => ({
    ...scene,
    audioChunks: await Promise.all((scene.audioChunks ?? []).map(async (chunk) => ({
      ...chunk,
      url: await signedR2MediaUrl(chunk.cacheKey, R2_MEDIA_SIGNED_URL_SECONDS),
    }))),
  }))),
};

console.log(`[video-existing-render-smoke] Bắt đầu render ${job.documentNumber} bằng template hiện tại.`);
const render = await startLegalVideoRender({jobId: job.jobId, storyboard});
await patchLegalVideoJob(job.jobId, {
  status: "rendering",
  progress: 78,
  message: "Đang kiểm tra template video mới trên Vercel Sandbox…",
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
  if (poll === 0 || (poll + 1) % 5 === 0 || progress.stage !== "render-progress") {
    console.log(`[video-existing-render-smoke] ${JSON.stringify({
      poll: poll + 1,
      stage: progress.stage,
      progress: Math.round(progress.overallProgress * 100),
      error: progress.error,
    })}`);
  }
  if (progress.stage === "error" || progress.stage === "expired") {
    await patchLegalVideoJob(job.jobId, {
      status: "failed",
      message: "Kiểm tra template video mới chưa hoàn tất.",
      error: progress.error || "Sandbox không hoàn tất render.",
    });
    throw new Error(progress.error || "[video-existing-render-smoke] Sandbox không hoàn tất render.");
  }
  if (progress.stage === "done" && progress.url && progress.pathname) {
    await patchLegalVideoJob(job.jobId, {
      status: "ready",
      progress: 100,
      message: "Video chi tiết đã sẵn sàng với template mới.",
      videoPath: progress.pathname,
      videoUrl: progress.url,
      error: null,
    });
    console.log(`[video-existing-render-smoke] READY ${progress.pathname}`);
    process.exit(0);
  }
  await patchLegalVideoJob(job.jobId, {
    status: "rendering",
    progress: Math.max(78, Math.min(98, 78 + Math.round(progress.overallProgress * 20))),
    message: `Đang kiểm tra template video mới… ${Math.round(progress.overallProgress * 100)}%`,
    error: null,
  });
}

await patchLegalVideoJob(job.jobId, {
  status: "failed",
  message: "Kiểm tra template video mới quá thời gian.",
  error: "Quá thời gian chờ Vercel Sandbox hoàn tất video.",
});
throw new Error("[video-existing-render-smoke] Quá thời gian chờ Vercel Sandbox hoàn tất video.");
