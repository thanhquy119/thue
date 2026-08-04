import {createHash, randomUUID} from "node:crypto";
import {NextResponse} from "next/server";
import {start} from "workflow/api";
import {cleanUserQuery, containsPromptInjection, extractSearchHint} from "@/lib/legal/query";
import {recentVerifiedDocumentResponse} from "@/lib/legal/recent-verified-documents";
import {searchTaxLawRobust} from "@/lib/legal/robust-search";
import {consumeMemoryRateLimit, requestFingerprint} from "@/lib/legal/security";
import type {DocumentDetail, SearchCandidate, TaxSearchResponse} from "@/lib/legal/types";
import {legalVideoCapabilities} from "@/lib/video/capabilities";
import {videoFingerprint} from "@/lib/video/fingerprint";
import {
  legalVideoGenerationPaused,
  legalVideoGenerationPauseMessage,
  legalVideoGenerationResumeAt,
} from "@/lib/video/generation-pause";
import {
  documentSnapshotPath,
  findReusableLegalVideoJob,
  publicLegalVideoJob,
  writeLegalVideoDocument,
  writeLegalVideoJob,
} from "@/lib/video/store";
import type {LegalVideoJob, LegalVideoLength, LegalVideoVoice} from "@/lib/video/types";
import {legalVideoGenerationWorkflow} from "@/workflows/legal-video-generation";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type StartBody = {
  query?: unknown;
  length?: unknown;
  voice?: unknown;
};

function legalVideoLength(value: unknown): LegalVideoLength {
  return value === "brief" || value === "detailed" ? value : "standard";
}

function legalVideoVoice(value: unknown): LegalVideoVoice {
  return value === "male" ? "male" : "female";
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/đ/giu, "d")
    .replace(/\s+/gu, "")
    .toLocaleLowerCase("vi");
}

function exactDocumentMatch(query: string, document: DocumentDetail) {
  const hint = extractSearchHint(query);
  if (!hint.number) return true;
  const number = normalize(document.number);
  if (!number.includes(normalize(hint.number))) return false;
  if (hint.year && !number.includes(normalize(hint.year))) return false;
  return true;
}

async function resolveDocument(query: string): Promise<TaxSearchResponse> {
  const recent = await recentVerifiedDocumentResponse(query);
  if (recent?.document) return recent;
  return searchTaxLawRobust(query);
}

function candidatePayload(candidates: SearchCandidate[] | undefined) {
  return (candidates ?? []).slice(0, 10).map((candidate) => ({
    number: candidate.number,
    title: candidate.title,
    issuer: candidate.issuer,
    issued_date: candidate.issued_date,
  }));
}

export async function POST(request: Request) {
  if (legalVideoGenerationPaused()) {
    return NextResponse.json(
      {
        error: legalVideoGenerationPauseMessage(),
        code: "VIDEO_GENERATION_PAUSED",
        resumeAt: legalVideoGenerationResumeAt(),
      },
      {status: 503, headers: {"cache-control": "no-store", "retry-after": "3600"}},
    );
  }

  const limit = consumeMemoryRateLimit(`video:${requestFingerprint(request)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      {error: `Em thao tác hơi nhanh. Vui lòng thử lại sau ${limit.retryAfter} giây.`},
      {status: 429, headers: {"retry-after": String(limit.retryAfter), "cache-control": "no-store"}},
    );
  }

  const capabilities = legalVideoCapabilities();
  if (!capabilities.ready) {
    return NextResponse.json(
      {
        error: "Pipeline video serverless chưa được cấu hình đầy đủ.",
        code: "VIDEO_PIPELINE_NOT_READY",
        missing: capabilities.missing,
      },
      {status: 503, headers: {"cache-control": "no-store"}},
    );
  }

  const body = (await request.json().catch(() => ({}))) as StartBody;
  const query = cleanUserQuery(body.query);
  if (query.length < 2 || query.length > 300) {
    return NextResponse.json({error: "Số hiệu hoặc tên văn bản phải có từ 2 đến 300 ký tự."}, {status: 400});
  }
  if (containsPromptInjection(query)) {
    return NextResponse.json({error: "Nội dung tìm kiếm không phù hợp."}, {status: 400});
  }

  const length = legalVideoLength(body.length);
  const voice = legalVideoVoice(body.voice);
  let response: TaxSearchResponse;
  try {
    response = await resolveDocument(query);
  } catch (error) {
    return NextResponse.json(
      {error: error instanceof Error ? error.message : "Không tìm được văn bản."},
      {status: 502, headers: {"cache-control": "no-store"}},
    );
  }

  const document = response.document;
  if (!document || !exactDocumentMatch(query, document)) {
    return NextResponse.json(
      {
        error: response.candidates?.length
          ? "Cần chọn đúng số hiệu văn bản trước khi tạo video."
          : "Chưa tìm thấy toàn văn chính xác để tạo video.",
        code: response.candidates?.length ? "DOCUMENT_SELECTION_REQUIRED" : "DOCUMENT_NOT_FOUND",
        candidates: candidatePayload(response.candidates),
      },
      {status: response.candidates?.length ? 409 : 404, headers: {"cache-control": "no-store"}},
    );
  }
  if (document.official_text.trim().length < 1_500) {
    return NextResponse.json(
      {error: "Toàn văn hiện chưa đủ nội dung để tạo video đáng tin cậy."},
      {status: 422, headers: {"cache-control": "no-store"}},
    );
  }

  const fingerprint = videoFingerprint({document, length, voice});
  const reusable = await findReusableLegalVideoJob(fingerprint);
  if (reusable) {
    return NextResponse.json(
      {ok: true, reused: true, job: publicLegalVideoJob(reusable)},
      {status: reusable.status === "ready" ? 200 : 202, headers: {"cache-control": "no-store"}},
    );
  }

  const jobId = randomUUID();
  const createdAt = new Date().toISOString();
  const snapshotPath = documentSnapshotPath(fingerprint);
  const job: LegalVideoJob = {
    version: 1,
    jobId,
    workflowRunId: null,
    fingerprint,
    documentNumber: document.number,
    documentTitle: document.title,
    documentSnapshotPath: snapshotPath,
    storyboardPath: null,
    status: "queued",
    progress: 1,
    message: "Đã xếp hàng tạo video.",
    length,
    voice,
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

  try {
    await writeLegalVideoDocument(snapshotPath, document);
    await writeLegalVideoJob(job);
    const run = await start(legalVideoGenerationWorkflow, [{jobId}]);
    const updated = await writeLegalVideoJob({...job, workflowRunId: run.runId});
    return NextResponse.json(
      {
        ok: true,
        reused: false,
        job: publicLegalVideoJob(updated),
        source_hash: createHash("sha256").update(document.official_text).digest("hex").slice(0, 16),
      },
      {status: 202, headers: {"cache-control": "no-store"}},
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không khởi động được pipeline video.";
    await writeLegalVideoJob({...job, status: "failed", message: "Không thể khởi động pipeline video.", error: message})
      .catch(() => undefined);
    return NextResponse.json({error: message}, {status: 500, headers: {"cache-control": "no-store"}});
  }
}
