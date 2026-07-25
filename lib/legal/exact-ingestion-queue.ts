import { createHash, randomUUID } from "node:crypto";
import {
  durableStoreAccess,
  durableStoreConfigured,
  readDurableIngestionState,
  readDurableRevision,
  writeDurableIngestionState,
} from "./durable-document-store.ts";
import {
  documentStorageKey,
  type DurableIngestionState,
  type DurableLegalSource,
} from "./durable-ingestion-types.ts";
import { shouldQueueExactIngestion } from "./exact-official-document-core.ts";
import { normalizeLegalQuery } from "./query.ts";
import { slugifyDocument } from "./ingestion.ts";
import type { SearchCandidate, TaxSearchResponse } from "./types.ts";

export type ExactQueueResult = {
  status: "started" | "processing" | "cooldown" | "unavailable" | "failed";
  state: DurableIngestionState | null;
};

async function claimSearchIngestion(number: string, sourceUrl: string) {
  const { put } = await import("@vercel/blob");
  const hour = new Date().toISOString().slice(0, 13);
  const sourceKey = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 16);
  const pathname = `legal-documents/${documentStorageKey(number)}/runs/search-claims/${hour}-${sourceKey}.json`;
  try {
    await put(pathname, JSON.stringify({ number, sourceUrl, claimedAt: new Date().toISOString() }), {
      access: durableStoreAccess(),
      allowOverwrite: false,
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
      contentType: "application/json; charset=utf-8",
    });
    return true;
  } catch {
    return false;
  }
}

export function shouldRetryExactWithBetterSource(
  state: DurableIngestionState | null,
  source: DurableLegalSource,
) {
  if (!state) return true;
  if (state.status === "ready" || state.status === "processing") return false;
  return Boolean(state.sourceUrl && state.sourceUrl !== source.sourceUrl);
}

export async function queueExactOfficialIngestion(source: DurableLegalSource): Promise<ExactQueueResult> {
  if (!durableStoreConfigured()) return { status: "unavailable", state: null };
  const revision = await readDurableRevision(source.number).catch(() => null);
  if (revision?.validation.accepted) return { status: "cooldown", state: null };

  const current = await readDurableIngestionState(source.number).catch(() => null);
  const mayStart = shouldQueueExactIngestion(current) || shouldRetryExactWithBetterSource(current, source);
  if (!mayStart) {
    return { status: current?.status === "processing" ? "processing" : "cooldown", state: current };
  }
  if (!(await claimSearchIngestion(source.number, source.sourceUrl))) {
    return { status: "processing", state: current };
  }

  const jobId = randomUUID();
  const queued: DurableIngestionState = {
    number: source.number,
    status: "processing",
    stage: "queued",
    runId: jobId,
    sourceUrl: source.sourceUrl,
    extractionMethod: null,
    processedPages: 0,
    totalPages: 0,
    qualityScore: null,
    warnings: [],
    error: null,
    updatedAt: new Date().toISOString(),
  };
  await writeDurableIngestionState(queued);

  try {
    const [{ start }, { legalDocumentIngestionWorkflow }] = await Promise.all([
      import("workflow/api"),
      import("../../workflows/legal-document-ingestion.ts"),
    ]);
    await start(legalDocumentIngestionWorkflow, [{ jobId, source, persist: true }]);
    return { status: "started", state: queued };
  } catch (error) {
    const failed: DurableIngestionState = {
      ...queued,
      status: "failed",
      stage: "completed",
      error: error instanceof Error ? error.message : "Không khởi động được pipeline nhập nền.",
      updatedAt: new Date().toISOString(),
    };
    await writeDurableIngestionState(failed).catch(() => undefined);
    return { status: "failed", state: failed };
  }
}

function candidate(source: DurableLegalSource): SearchCandidate {
  return {
    id: `exact-${slugifyDocument(source.number)}`,
    number: source.number,
    title: source.title,
    type: source.type,
    issuer: source.issuer || "Chưa xác định cơ quan ban hành",
    issued_date: source.issuedDate,
    source_url: source.officialPageUrl || source.sourceUrl,
    source_label: source.sourceLabel,
  };
}

function queueMessage(number: string, queue: ExactQueueResult) {
  if (queue.status === "started") {
    return `Đã xác định đúng ${number} và đã đưa bản scan chính thức vào pipeline OCR nền. Hệ thống đang xử lý theo từng nhóm trang; chỉ khi đủ toàn văn và vượt kiểm tra chất lượng thì lần tra cứu tiếp theo mới hiển thị nội dung.`;
  }
  if (queue.status === "processing") {
    return `Đã xác định đúng ${number}. Bản scan chính thức đang được OCR nền và chưa được công bố như toàn văn cho đến khi xử lý đủ trang.`;
  }
  if (queue.status === "cooldown") {
    return `Đã xác định đúng ${number}. Lượt nhập gần nhất đã được ghi nhận; hệ thống không tạo công việc trùng và sẽ tự tiếp tục theo trạng thái đã lưu.`;
  }
  if (queue.status === "failed") {
    return `Đã xác định đúng ${number}, nhưng lượt OCR nền chưa khởi động thành công. Liên kết nguồn chính thức vẫn được giữ và nguồn tốt hơn có thể được thử lại mà không phải chờ URL cũ hết thời gian khóa.`;
  }
  return `Đã xác định đúng ${number}, nhưng kho nhập nền chưa sẵn sàng. Hệ thống không dùng bài giới thiệu hoặc phần khung trang thay cho toàn văn pháp luật.`;
}

export async function exactQueuedResponse(
  query: string,
  source: DurableLegalSource,
  warnings: string[] = [],
): Promise<TaxSearchResponse> {
  const queue = await queueExactOfficialIngestion(source).catch(() => ({
    status: "failed" as const,
    state: null,
  }));
  return {
    query_normalized: normalizeLegalQuery(query),
    query_kind: "document",
    direct_answer: queueMessage(source.number, queue),
    document: null,
    candidates: [candidate(source)],
    warnings: Array.from(new Set(warnings)).slice(0, 5),
    confidence: queue.status === "started" || queue.status === "processing" ? 0.9 : 0.72,
    retrieved_at: new Date().toISOString(),
  };
}
