import {readLegalVideoJob} from "@/lib/video/store";

const fallbackJobIds = [
  "6e3c154f-3390-49d2-8ee3-fb42701e1b75",
  "b2561e56-9a88-4f5c-b441-e206768800c6",
];

const configuredJobIds = (process.env.VIDEO_STATUS_JOB_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => /^[0-9a-f-]{20,64}$/iu.test(value));

const jobIds = configuredJobIds.length ? configuredJobIds : fallbackJobIds;

for (const jobId of jobIds) {
  const job = await readLegalVideoJob(jobId);
  if (!job) {
    console.log(`[video-status] ${JSON.stringify({jobId, found: false})}`);
    continue;
  }

  console.log(`[video-status] ${JSON.stringify({
    jobId: job.jobId,
    workflowRunId: job.workflowRunId,
    found: true,
    documentNumber: job.documentNumber,
    length: job.length,
    voice: job.voice,
    status: job.status,
    terminal: job.status === "ready" || job.status === "failed",
    progress: job.progress,
    message: job.message,
    sceneCount: job.sceneCount,
    ttsChunkCount: job.ttsChunkCount,
    completedTtsChunks: job.completedTtsChunks,
    remainingTtsChunks: Math.max(0, job.ttsChunkCount - job.completedTtsChunks),
    storyboardReady: Boolean(job.storyboardPath),
    renderStarted: Boolean(job.renderSandboxId || job.renderCommandId),
    videoReady: Boolean(job.videoUrl),
    videoPath: job.videoPath || null,
    error: job.error,
    updatedAt: job.updatedAt,
  })}`);
}
