import {randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {recentVerifiedDocumentResponse} from "@/lib/legal/recent-verified-documents";
import {searchTaxLawRobust} from "@/lib/legal/robust-search";
import {azureVoiceName, AzureTtsError, synthesizeAzureVietnamese} from "@/lib/video/azure-tts";
import {readCachedTtsAsset, ttsCacheKey, writeTtsAsset} from "@/lib/video/blob-assets";
import {
  buildVideoEvidenceSections,
  splitVietnameseTtsText,
  videoEvidenceSectionChars,
  VIDEO_TEMPLATE_VERSION,
} from "@/lib/video/chunking";
import {legalVideoCapabilities} from "@/lib/video/capabilities";
import {videoFingerprint} from "@/lib/video/fingerprint";
import {legalVideoRenderProgress, startLegalVideoRender} from "@/lib/video/remotion-renderer";
import {
  documentSnapshotPath,
  patchLegalVideoJob,
  storyboardPath,
  writeLegalVideoDocument,
  writeLegalVideoJob,
  writeLegalVideoStoryboard,
} from "@/lib/video/store";
import {createLegalVideoStoryboard, summarizeVideoEvidenceSection} from "@/lib/video/storyboard";
import type {
  LegalVideoAudioChunk,
  LegalVideoEvidencePoint,
  LegalVideoJob,
  LegalVideoScene,
  LegalVideoStoryboard,
} from "@/lib/video/types";

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

const capabilities = legalVideoCapabilities();
if (!capabilities.ready) {
  throw new Error(`[video-v3-e2e] Pipeline chưa sẵn sàng: ${capabilities.missing.join(", ")}`);
}

const query = process.env.VIDEO_V3_E2E_DOCUMENT?.trim() || "94/2026/TT-BTC";
const recent = await recentVerifiedDocumentResponse(query);
const search = recent?.document ? recent : await searchTaxLawRobust(query);
const document = search.document;
if (!document || document.official_text.trim().length < 1_500) {
  throw new Error(`[video-v3-e2e] Không tìm thấy toàn văn đầy đủ của ${query}.`);
}

const fingerprint = videoFingerprint({document, length: "detailed", voice: "female"});
const jobId = randomUUID();
const createdAt = new Date().toISOString();
const snapshotPath = documentSnapshotPath(fingerprint);
const internalStoryboardPath = storyboardPath(jobId);
let job: LegalVideoJob = {
  version: 1,
  jobId,
  workflowRunId: `direct-build-${process.env.VERCEL_DEPLOYMENT_ID || "local"}`,
  fingerprint,
  documentNumber: document.number,
  documentTitle: document.title,
  documentSnapshotPath: snapshotPath,
  storyboardPath: null,
  status: "queued",
  progress: 1,
  message: "Đã xếp hàng kiểm thử video v3.",
  length: "detailed",
  voice: "female",
  sceneCount: 0,
  ttsChunkCount: 0,
  completedTtsChunks: 0,
  renderSandboxId: null,
  renderCommandId: null,
  videoPath: null,
  videoUrl: null,
  error: null,
  createdAt,
  updatedAt: createdAt,
};

await writeLegalVideoDocument(snapshotPath, document);
job = await writeLegalVideoJob(job);
console.log(`[video-v3-e2e] ${JSON.stringify({
  event: "started",
  jobId,
  workflowRunId: job.workflowRunId,
  documentNumber: job.documentNumber,
  templateVersion: VIDEO_TEMPLATE_VERSION,
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

  console.log(`[video-v3-e2e] ${JSON.stringify({
    event: "storyboard-ready",
    templateVersion: storyboard.templateVersion,
    sceneCount: storyboard.scenes.length,
    categories: Array.from(new Set(storyboard.scenes.map((scene) => scene.category))),
    coverageScore: storyboard.coverage.coverageScore,
    scenes: storyboard.scenes.map((scene) => ({
      id: scene.id,
      kind: scene.kind,
      title: scene.title,
      bullets: scene.bullets,
      narration: scene.narration,
      captions: scene.captionChunks,
    })),
  })}`);
}

function transientGemini(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /429|quota|rate.?limit|resource.?exhausted|500|502|503|504|timeout|abort|temporar/iu.test(message);
}

await patchLegalVideoJob(jobId, {
  status: "summarizing",
  progress: 5,
  message: "Đang kiểm thử biên tập nội dung video v3…",
  error: null,
});

const sections = buildVideoEvidenceSections(
  document,
  videoEvidenceSectionChars(document, "detailed"),
);
if (!sections.length) throw new Error("[video-v3-e2e] Không chia được toàn văn thành các phần evidence.");

const points: LegalVideoEvidencePoint[] = [];
for (let index = 0; index < sections.length; index += 1) {
  let sectionPoints: LegalVideoEvidencePoint[] | null = null;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      sectionPoints = await summarizeVideoEvidenceSection(document, sections[index]);
      break;
    } catch (error) {
      if (!transientGemini(error) || attempt === 12) throw error;
      const waitSeconds = /429|quota|rate.?limit|resource.?exhausted/iu.test(String(error)) ? 65 : 15;
      console.log(`[video-v3-e2e] Gemini tạm bận ở phần ${index + 1}/${sections.length}; chờ ${waitSeconds} giây.`);
      await delay(waitSeconds * 1_000);
    }
  }
  if (!sectionPoints?.length) throw new Error(`[video-v3-e2e] Không phân tích được phần ${index + 1}.`);
  points.push(...sectionPoints);
  const progress = 6 + Math.round(((index + 1) / sections.length) * 28);
  await patchLegalVideoJob(jobId, {
    status: "summarizing",
    progress,
    message: `Đã phân tích ${index + 1}/${sections.length} phần của văn bản…`,
  });
  console.log(`[video-v3-e2e] ${JSON.stringify({event: "evidence", part: index + 1, total: sections.length, pointCount: sectionPoints.length, progress})}`);
  if (index < sections.length - 1) await delay(5_000);
}

let storyboard: LegalVideoStoryboard | null = null;
for (let attempt = 1; attempt <= 12; attempt += 1) {
  try {
    storyboard = await createLegalVideoStoryboard({
      document,
      points,
      length: "detailed",
      voice: "female",
    });
    break;
  } catch (error) {
    if (!transientGemini(error) || attempt === 12) throw error;
    const waitSeconds = /429|quota|rate.?limit|resource.?exhausted/iu.test(String(error)) ? 65 : 15;
    console.log(`[video-v3-e2e] Gemini tạm bận khi dựng storyboard; chờ ${waitSeconds} giây.`);
    await delay(waitSeconds * 1_000);
  }
}
if (!storyboard) throw new Error("[video-v3-e2e] Không tạo được storyboard.");
inspectStoryboard(storyboard);
await writeLegalVideoStoryboard(internalStoryboardPath, storyboard);
await patchLegalVideoJob(jobId, {
  status: "synthesizing",
  progress: 38,
  message: `Đã tạo ${storyboard.scenes.length} cảnh v3; đang tạo giọng đọc…`,
  storyboardPath: internalStoryboardPath,
  sceneCount: storyboard.scenes.length,
  error: null,
});

const speechChunks = storyboard.scenes.flatMap((scene) =>
  splitVietnameseTtsText(scene.narration).map((text, index) => ({
    sceneId: scene.id,
    chunkIndex: index,
    text,
  })),
);
if (!speechChunks.length) throw new Error("[video-v3-e2e] Storyboard chưa có lời đọc.");
await patchLegalVideoJob(jobId, {ttsChunkCount: speechChunks.length});

const audioByScene = new Map<string, LegalVideoAudioChunk[]>();
const voiceName = azureVoiceName("female");
const rate = process.env.VIDEO_TTS_RATE?.trim() || "-4%";
const pitch = process.env.VIDEO_TTS_PITCH?.trim() || "+0Hz";

for (let index = 0; index < speechChunks.length; index += 1) {
  const chunk = speechChunks[index];
  const cacheKey = await ttsCacheKey({voice: voiceName, rate, pitch, text: chunk.text});
  let asset = await readCachedTtsAsset(cacheKey);
  let cached = Boolean(asset);
  if (!asset) {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      try {
        const generated = await synthesizeAzureVietnamese({text: chunk.text, voice: "female"});
        asset = await writeTtsAsset({
          key: cacheKey,
          bytes: generated.bytes,
          durationSeconds: generated.durationSeconds,
          voice: generated.voice,
        });
        break;
      } catch (error) {
        const retryable = error instanceof AzureTtsError ? error.retryable : true;
        if (!retryable || attempt === 20) throw error;
        const retryAfterMs = error instanceof AzureTtsError ? error.retryAfterMs : 5_000;
        const waitMs = Math.max(4_000, Math.min(300_000, retryAfterMs));
        console.log(`[video-v3-e2e] Azure tạm bận ở đoạn ${index + 1}/${speechChunks.length}; chờ ${Math.ceil(waitMs / 1_000)} giây.`);
        await delay(waitMs);
      }
    }
  }
  if (!asset) throw new Error(`[video-v3-e2e] Không tạo được giọng đọc đoạn ${index + 1}.`);
  const current = audioByScene.get(chunk.sceneId) ?? [];
  current.push({
    id: `${chunk.sceneId}-audio-${chunk.chunkIndex + 1}`,
    text: chunk.text,
    url: asset.url,
    durationSeconds: asset.durationSeconds,
    cacheKey: asset.cacheKey,
  });
  audioByScene.set(chunk.sceneId, current);
  const progress = 40 + Math.round(((index + 1) / speechChunks.length) * 35);
  await patchLegalVideoJob(jobId, {
    status: "synthesizing",
    completedTtsChunks: index + 1,
    progress,
    message: `Đã tạo giọng đọc ${index + 1}/${speechChunks.length} đoạn…`,
    error: null,
  });
  console.log(`[video-v3-e2e] ${JSON.stringify({event: "tts", current: index + 1, total: speechChunks.length, cached, progress})}`);
  if (!cached && index < speechChunks.length - 1) await delay(4_000);
}

const withAudio: LegalVideoStoryboard = {
  ...storyboard,
  scenes: storyboard.scenes.map((scene): LegalVideoScene => ({
    ...scene,
    audioChunks: audioByScene.get(scene.id) ?? [],
  })),
};
await writeLegalVideoStoryboard(internalStoryboardPath, withAudio);

const render = await startLegalVideoRender({jobId, storyboard: withAudio});
await patchLegalVideoJob(jobId, {
  status: "rendering",
  progress: 78,
  message: "Đang dựng MP4 bằng template pastel v3…",
  renderSandboxId: render.sandboxId,
  renderCommandId: render.commandId,
  videoPath: render.outputPath,
  videoUrl: null,
  error: null,
});

for (let poll = 0; poll < 240; poll += 1) {
  await delay(5_000);
  const progress = await legalVideoRenderProgress({
    jobId,
    sandboxId: render.sandboxId,
    commandId: render.commandId,
    outputFile: render.outputFile,
    outputPath: render.outputPath,
  });
  if (poll === 0 || (poll + 1) % 5 === 0 || progress.stage !== "render-progress") {
    console.log(`[video-v3-e2e] ${JSON.stringify({
      event: "render",
      poll: poll + 1,
      stage: progress.stage,
      progress: Math.round(progress.overallProgress * 100),
      error: progress.error,
    })}`);
  }
  if (progress.stage === "error" || progress.stage === "expired") {
    await patchLegalVideoJob(jobId, {
      status: "failed",
      message: "Kiểm thử render v3 thất bại.",
      error: progress.error || "Sandbox không hoàn tất render.",
    });
    throw new Error(progress.error || "[video-v3-e2e] Sandbox không hoàn tất render.");
  }
  if (progress.stage === "done" && progress.url && progress.pathname) {
    await patchLegalVideoJob(jobId, {
      status: "ready",
      progress: 100,
      message: "Video chi tiết v3 đã sẵn sàng.",
      videoPath: progress.pathname,
      videoUrl: progress.url,
      error: null,
    });
    console.log(`[video-v3-e2e] ${JSON.stringify({
      event: "ready",
      jobId,
      workflowRunId: job.workflowRunId,
      sceneCount: storyboard.scenes.length,
      ttsChunkCount: speechChunks.length,
      videoPath: progress.pathname,
    })}`);
    process.exit(0);
  }
  await patchLegalVideoJob(jobId, {
    status: "rendering",
    progress: Math.max(78, Math.min(98, 78 + Math.round(progress.overallProgress * 20))),
    message: `Đang dựng MP4 bằng template pastel v3… ${Math.round(progress.overallProgress * 100)}%`,
    error: null,
  });
}

await patchLegalVideoJob(jobId, {
  status: "failed",
  message: "Kiểm thử render v3 quá thời gian.",
  error: "Quá thời gian chờ Sandbox hoàn tất render.",
});
throw new Error(`[video-v3-e2e] Quá thời gian chờ job ${jobId} hoàn tất.`);
