import {sleep} from "workflow";
import {azureVoiceName, AzureTtsError, synthesizeAzureVietnamese} from "@/lib/video/azure-tts";
import {readCachedTtsAsset, ttsCacheKey, writeTtsAsset} from "@/lib/video/aws-assets";
import {buildVideoEvidenceSections, splitVietnameseTtsText} from "@/lib/video/chunking";
import {legalVideoRenderProgress, startLegalVideoRender} from "@/lib/video/remotion-renderer";
import {
  patchLegalVideoJob,
  readLegalVideoDocument,
  readLegalVideoJob,
  storyboardPath,
  writeLegalVideoStoryboard,
} from "@/lib/video/store";
import {createLegalVideoStoryboard, summarizeVideoEvidenceSection} from "@/lib/video/storyboard";
import type {
  LegalVideoAudioChunk,
  LegalVideoJob,
  LegalVideoScene,
  LegalVideoStoryboard,
  LegalVideoWorkflowInput,
  LegalVideoWorkflowResult,
  LegalVideoVoice,
} from "@/lib/video/types";

const TTS_MAX_ATTEMPTS = 5;
const RENDER_MAX_POLLS = 180;

function now() {
  return new Date().toISOString();
}

function ttsPacingSeconds() {
  const configured = Number(process.env.VIDEO_TTS_MIN_INTERVAL_MS || 4_000);
  const milliseconds = Number.isFinite(configured) ? Math.max(3_200, configured) : 4_000;
  return Math.max(4, Math.ceil(milliseconds / 1_000));
}

function retrySeconds(milliseconds: number) {
  return Math.max(2, Math.min(180, Math.ceil(milliseconds / 1_000)));
}

export async function legalVideoGenerationWorkflow(
  input: LegalVideoWorkflowInput,
): Promise<LegalVideoWorkflowResult> {
  "use workflow";

  try {
    const job = await readJobStep(input.jobId);
    if (!job) throw new Error(`Không tìm thấy job video ${input.jobId}.`);
    const document = await readDocumentStep(job.documentSnapshotPath);
    if (!document) throw new Error("Bản chụp toàn văn dùng để tạo video không còn tồn tại.");

    await patchJobStep(job.jobId, {
      status: "summarizing",
      progress: 5,
      message: "Đang đọc cấu trúc và chọn các ý chính của văn bản…",
      error: null,
    });

    const sections = buildVideoEvidenceSections(document);
    if (!sections.length) throw new Error("Toàn văn chưa có đủ nội dung để tạo video.");
    const points = [];
    for (let index = 0; index < sections.length; index += 1) {
      const sectionPoints = await summarizeSectionStep(document, sections[index]);
      points.push(...sectionPoints);
      const progress = 6 + Math.round(((index + 1) / sections.length) * 28);
      await patchJobStep(job.jobId, {
        status: "summarizing",
        progress,
        message: `Đã phân tích ${index + 1}/${sections.length} phần của văn bản…`,
      });
    }
    if (!points.length) throw new Error("Chưa trích xuất được ý chính có dẫn chứng từ toàn văn.");

    const storyboard = await createStoryboardStep({
      document,
      points,
      length: job.length,
      voice: job.voice,
    });
    const internalStoryboardPath = storyboardPath(job.jobId);
    await writeStoryboardStep(internalStoryboardPath, storyboard);
    await patchJobStep(job.jobId, {
      status: "synthesizing",
      progress: 38,
      message: `Đã tạo ${storyboard.scenes.length} cảnh; đang chuẩn bị giọng đọc tiếng Việt…`,
      storyboardPath: internalStoryboardPath,
      sceneCount: storyboard.scenes.length,
    });

    const speechChunks = storyboard.scenes.flatMap((scene) =>
      splitVietnameseTtsText(scene.narration).map((text, index) => ({
        sceneId: scene.id,
        chunkIndex: index,
        text,
      })),
    );
    if (!speechChunks.length) throw new Error("Storyboard chưa có lời đọc.");
    await patchJobStep(job.jobId, {ttsChunkCount: speechChunks.length});

    const audioByScene = new Map<string, LegalVideoAudioChunk[]>();
    for (let index = 0; index < speechChunks.length; index += 1) {
      const chunk = speechChunks[index];
      let completed: Awaited<ReturnType<typeof synthesizeTtsChunkStep>> | null = null;
      for (let attempt = 1; attempt <= TTS_MAX_ATTEMPTS; attempt += 1) {
        const result = await synthesizeTtsChunkStep({
          text: chunk.text,
          voice: job.voice,
          id: `${chunk.sceneId}-audio-${chunk.chunkIndex + 1}`,
        });
        if (result.ok) {
          completed = result;
          if (!result.cached && index < speechChunks.length - 1) {
            await sleep(`${ttsPacingSeconds()} seconds`);
          }
          break;
        }
        if (!result.retryable || attempt === TTS_MAX_ATTEMPTS) {
          throw new Error(result.error || "Tạo giọng đọc thất bại.");
        }
        await patchJobStep(job.jobId, {
          status: "synthesizing",
          message: `Dịch vụ giọng đọc đang bận; giữ nguyên tiến độ và thử lại đoạn ${index + 1}/${speechChunks.length}…`,
        });
        await sleep(`${retrySeconds(result.retryAfterMs)} seconds`);
      }
      if (!completed?.ok) throw new Error("Không hoàn tất được một đoạn giọng đọc.");
      const current = audioByScene.get(chunk.sceneId) ?? [];
      current.push({
        id: completed.id,
        text: chunk.text,
        url: completed.url,
        durationSeconds: completed.durationSeconds,
        cacheKey: completed.cacheKey,
      });
      audioByScene.set(chunk.sceneId, current);
      await patchJobStep(job.jobId, {
        status: "synthesizing",
        completedTtsChunks: index + 1,
        progress: 40 + Math.round(((index + 1) / speechChunks.length) * 35),
        message: `Đã tạo giọng đọc ${index + 1}/${speechChunks.length} đoạn…`,
      });
    }

    const withAudio: LegalVideoStoryboard = {
      ...storyboard,
      scenes: storyboard.scenes.map((scene): LegalVideoScene => ({
        ...scene,
        audioChunks: audioByScene.get(scene.id) ?? [],
      })),
    };
    await writeStoryboardStep(internalStoryboardPath, withAudio);

    const render = await startRenderStep(job.jobId, withAudio);
    await patchJobStep(job.jobId, {
      status: "rendering",
      progress: 78,
      message: "Đang dựng hình, ghép giọng đọc và xuất MP4…",
      renderId: render.renderId,
      renderBucket: render.bucketName,
    });

    for (let poll = 0; poll < RENDER_MAX_POLLS; poll += 1) {
      await sleep("10 seconds");
      const progress = await renderProgressStep(render.renderId, render.bucketName);
      if (progress.fatalErrorEncountered) {
        throw new Error(progress.error || "Remotion Lambda không thể hoàn tất video.");
      }
      if (progress.done && progress.outputFile) {
        await patchJobStep(job.jobId, {
          status: "ready",
          progress: 100,
          message: "Video tóm tắt đã sẵn sàng.",
          videoUrl: progress.outputFile,
          error: null,
        });
        return {jobId: job.jobId, status: "ready", videoUrl: progress.outputFile, error: null};
      }
      await patchJobStep(job.jobId, {
        status: "rendering",
        progress: Math.max(78, Math.min(98, 78 + Math.round(progress.overallProgress * 20))),
        message: `Đang xuất video… ${Math.round(progress.overallProgress * 100)}%`,
      });
    }
    throw new Error("Quá thời gian chờ Remotion Lambda hoàn tất video.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tạo video thất bại.";
    await patchJobStep(input.jobId, {
      status: "failed",
      message: "Không thể hoàn tất video.",
      error: message,
    }).catch(() => undefined);
    return {jobId: input.jobId, status: "failed", videoUrl: null, error: message};
  }
}

async function readJobStep(jobId: string) {
  "use step";
  return readLegalVideoJob(jobId);
}

async function readDocumentStep(pathname: string) {
  "use step";
  return readLegalVideoDocument(pathname);
}

async function patchJobStep(jobId: string, patch: Partial<LegalVideoJob>) {
  "use step";
  return patchLegalVideoJob(jobId, {...patch, updatedAt: now()});
}

async function summarizeSectionStep(
  document: Parameters<typeof summarizeVideoEvidenceSection>[0],
  section: Parameters<typeof summarizeVideoEvidenceSection>[1],
) {
  "use step";
  return summarizeVideoEvidenceSection(document, section);
}

async function createStoryboardStep(
  input: Parameters<typeof createLegalVideoStoryboard>[0],
) {
  "use step";
  return createLegalVideoStoryboard(input);
}

async function writeStoryboardStep(pathname: string, storyboard: LegalVideoStoryboard) {
  "use step";
  await writeLegalVideoStoryboard(pathname, storyboard);
}

type TtsStepResult =
  | {
      ok: true;
      id: string;
      url: string;
      durationSeconds: number;
      cacheKey: string;
      cached: boolean;
    }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      retryAfterMs: number;
    };

async function synthesizeTtsChunkStep(input: {
  id: string;
  text: string;
  voice: LegalVideoVoice;
}): Promise<TtsStepResult> {
  "use step";
  const voiceName = azureVoiceName(input.voice);
  const rate = process.env.VIDEO_TTS_RATE?.trim() || "-4%";
  const pitch = process.env.VIDEO_TTS_PITCH?.trim() || "+0Hz";
  const cacheKey = ttsCacheKey({voice: voiceName, rate, pitch, text: input.text});
  const cached = await readCachedTtsAsset(cacheKey);
  if (cached) return {ok: true, id: input.id, ...cached};
  try {
    const generated = await synthesizeAzureVietnamese({text: input.text, voice: input.voice});
    const stored = await writeTtsAsset({
      key: cacheKey,
      bytes: generated.bytes,
      durationSeconds: generated.durationSeconds,
      voice: generated.voice,
    });
    return {ok: true, id: input.id, ...stored};
  } catch (error) {
    if (error instanceof AzureTtsError) {
      return {
        ok: false,
        error: error.message,
        retryable: error.retryable,
        retryAfterMs: error.retryAfterMs,
      };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Tạo giọng đọc thất bại.",
      retryable: true,
      retryAfterMs: 5_000,
    };
  }
}

async function startRenderStep(jobId: string, storyboard: LegalVideoStoryboard) {
  "use step";
  return startLegalVideoRender({jobId, storyboard});
}

async function renderProgressStep(renderId: string, bucketName: string) {
  "use step";
  const progress = await legalVideoRenderProgress({renderId, bucketName});
  return {
    done: progress.done,
    overallProgress: progress.overallProgress,
    outputFile: progress.outputFile,
    fatalErrorEncountered: progress.fatalErrorEncountered,
    error: progress.errors?.[0]?.message || null,
  };
}
