import {setTimeout as delay} from "node:timers/promises";
import {POST as startVideo} from "@/app/api/videos/start/route";
import {VIDEO_TEMPLATE_VERSION} from "@/lib/video/chunking";
import {readLegalVideoJob, readLegalVideoStoryboard} from "@/lib/video/store";
import type {LegalVideoPublicJob, LegalVideoStoryboard} from "@/lib/video/types";

const enabled = process.env.RUN_VIDEO_V3_E2E === "true"
  || /\[video-v3-e2e\]/iu.test(process.env.VERCEL_GIT_COMMIT_MESSAGE || "");

if (!enabled) {
  console.log("[video-v3-e2e] Bỏ qua; thêm [video-v3-e2e] vào commit hoặc bật RUN_VIDEO_V3_E2E.");
  process.exit(0);
}

if (process.env.VERCEL_ENV === "production") {
  console.log("[video-v3-e2e] Bỏ qua trên production.");
  process.exit(0);
}

const request = new Request("https://video-v3-smoke.local/api/videos/start", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "user-agent": "Thue-Ro-video-v3-build-smoke",
    "x-forwarded-for": "127.0.0.1",
  },
  body: JSON.stringify({
    query: process.env.VIDEO_V3_E2E_DOCUMENT?.trim() || "94/2026/TT-BTC",
    length: "detailed",
    voice: "female",
  }),
});

const response = await startVideo(request);
const payload = await response.json() as {
  ok?: unknown;
  reused?: unknown;
  job?: LegalVideoPublicJob;
  error?: unknown;
  code?: unknown;
};

if (!response.ok || payload.ok !== true || !payload.job?.jobId) {
  throw new Error(`[video-v3-e2e] Không khởi động được job: ${JSON.stringify({
    status: response.status,
    error: payload.error,
    code: payload.code,
  })}`);
}

const jobId = payload.job.jobId;
console.log(`[video-v3-e2e] ${JSON.stringify({
  event: "started",
  jobId,
  workflowRunId: payload.job.workflowRunId,
  reused: payload.reused === true,
  documentNumber: payload.job.documentNumber,
})}`);

function normalize(value: string) {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase("vi");
}

function inspectStoryboard(storyboard: LegalVideoStoryboard) {
  if (storyboard.templateVersion !== VIDEO_TEMPLATE_VERSION) {
    throw new Error(`[video-v3-e2e] Sai template: ${storyboard.templateVersion}`);
  }
  if (storyboard.scenes.length < 8) {
    throw new Error(`[video-v3-e2e] Storyboard quá ngắn: ${storyboard.scenes.length} cảnh.`);
  }
  for (const scene of storyboard.scenes) {
    if (!scene.title.trim() || scene.title.length > 92) {
      throw new Error(`[video-v3-e2e] Tiêu đề cảnh không đạt: ${scene.id} (${scene.title.length} ký tự).`);
    }
    if (scene.bullets.length > 3) {
      throw new Error(`[video-v3-e2e] Cảnh ${scene.id} có quá 3 gạch đầu dòng.`);
    }
    if (scene.bullets.some((bullet) => bullet.length > 140)) {
      throw new Error(`[video-v3-e2e] Cảnh ${scene.id} có gạch đầu dòng quá dài.`);
    }
    if (scene.captionChunks.some((caption) => caption.length > 150)) {
      throw new Error(`[video-v3-e2e] Cảnh ${scene.id} có phụ đề quá dài.`);
    }
  }

  const normalizedTitles = storyboard.scenes.map((scene) => normalize(scene.title));
  if (new Set(normalizedTitles).size !== normalizedTitles.length) {
    throw new Error("[video-v3-e2e] Storyboard có tiêu đề cảnh bị lặp.");
  }

  const issued = storyboard.document.issued_date;
  const effective = storyboard.document.effective_date;
  if (issued && effective && issued === effective) {
    const timeline = storyboard.scenes.find((scene) => scene.category === "effective");
    if (!timeline || timeline.bullets.length !== 1 || !/ban hành và có hiệu lực/iu.test(timeline.bullets[0])) {
      throw new Error("[video-v3-e2e] Ngày ban hành trùng ngày hiệu lực nhưng chưa được gộp thành một mốc.");
    }
  }

  const categories = Array.from(new Set(storyboard.scenes.map((scene) => scene.category)));
  console.log(`[video-v3-e2e] ${JSON.stringify({
    event: "storyboard-ready",
    templateVersion: storyboard.templateVersion,
    sceneCount: storyboard.scenes.length,
    categories,
    coverageScore: storyboard.coverage.coverageScore,
    scenes: storyboard.scenes.map((scene) => ({
      id: scene.id,
      kind: scene.kind,
      title: scene.title,
      bullets: scene.bullets,
      captionCount: scene.captionChunks.length,
    })),
  })}`);
}

let inspectedStoryboardPath = "";
let lastStatus = "";
let lastProgress = -1;
const maxPolls = 180;

for (let poll = 0; poll < maxPolls; poll += 1) {
  if (poll > 0) await delay(15_000);
  const job = await readLegalVideoJob(jobId);
  if (!job) throw new Error(`[video-v3-e2e] Không đọc được job ${jobId} trên R2.`);

  if (job.status !== lastStatus || job.progress !== lastProgress || (poll + 1) % 8 === 0) {
    console.log(`[video-v3-e2e] ${JSON.stringify({
      event: "progress",
      poll: poll + 1,
      status: job.status,
      progress: job.progress,
      message: job.message,
      sceneCount: job.sceneCount,
      tts: `${job.completedTtsChunks}/${job.ttsChunkCount}`,
      error: job.error,
    })}`);
    lastStatus = job.status;
    lastProgress = job.progress;
  }

  if (job.storyboardPath && job.storyboardPath !== inspectedStoryboardPath) {
    const storyboard = await readLegalVideoStoryboard(job.storyboardPath);
    if (storyboard) {
      inspectStoryboard(storyboard);
      inspectedStoryboardPath = job.storyboardPath;
    }
  }

  if (job.status === "failed") {
    throw new Error(`[video-v3-e2e] Job thất bại: ${job.error || job.message}`);
  }
  if (job.status === "ready") {
    if (!job.videoPath || !job.videoUrl) {
      throw new Error("[video-v3-e2e] Job ready nhưng chưa có đường dẫn MP4.");
    }
    if (!inspectedStoryboardPath) {
      throw new Error("[video-v3-e2e] Job ready nhưng chưa kiểm tra được storyboard.");
    }
    console.log(`[video-v3-e2e] ${JSON.stringify({
      event: "ready",
      jobId,
      workflowRunId: job.workflowRunId,
      sceneCount: job.sceneCount,
      ttsChunkCount: job.ttsChunkCount,
      videoPath: job.videoPath,
      updatedAt: job.updatedAt,
    })}`);
    process.exit(0);
  }
}

throw new Error(`[video-v3-e2e] Quá thời gian chờ job ${jobId} hoàn tất.`);
