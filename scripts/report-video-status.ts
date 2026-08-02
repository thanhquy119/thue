import {setTimeout as delay} from "node:timers/promises";
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
const waitForTerminal = /\[video-status-wait\]/iu.test(process.env.VERCEL_GIT_COMMIT_MESSAGE || "");
const watchedJobId = process.env.VIDEO_STATUS_WATCH_JOB_ID?.trim()
  || "b2561e56-9a88-4f5c-b441-e206768800c6";

function publicStatus(job: NonNullable<Awaited<ReturnType<typeof readLegalVideoJob>>>) {
  return {
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
  };
}

for (const jobId of jobIds) {
  const job = await readLegalVideoJob(jobId);
  console.log(`[video-status] ${JSON.stringify(job ? publicStatus(job) : {jobId, found: false})}`);
}

if (waitForTerminal && /^[0-9a-f-]{20,64}$/iu.test(watchedJobId)) {
  console.log(`[video-status-watch] Bắt đầu theo dõi ${watchedJobId} trong tối đa 12 phút.`);
  let previousSignature = "";
  for (let poll = 1; poll <= 72; poll += 1) {
    const job = await readLegalVideoJob(watchedJobId);
    if (!job) {
      console.log(`[video-status-watch] ${JSON.stringify({poll, jobId: watchedJobId, found: false})}`);
      break;
    }
    const status = publicStatus(job);
    const signature = `${status.status}:${status.progress}:${status.completedTtsChunks}:${status.videoReady}:${status.updatedAt}`;
    if (signature !== previousSignature || poll % 6 === 0) {
      console.log(`[video-status-watch] ${JSON.stringify({poll, ...status})}`);
      previousSignature = signature;
    }
    if (status.terminal) break;
    await delay(10_000);
  }
}
