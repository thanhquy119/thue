import type { DurablePublishedRevision } from "./durable-document-store.ts";
import type { DurableIngestionState } from "./durable-ingestion-types.ts";
import type { SearchCandidate, TaxSearchResponse } from "./types.ts";

const EXACT_NUMBER_PATTERN = /\b\d{1,4}\s*\/\s*20\d{2}\s*\/\s*(?:TT-[A-ZĐ0-9-]+|NĐ-CP|QĐ-[A-ZĐ0-9-]+|NQ-[A-ZĐ0-9-]+|QH\d*|UBTVQH\d*)\b/iu;

export function extractExactLegalNumber(value: string) {
  const match = value.match(EXACT_NUMBER_PATTERN)?.[0];
  return match ? match.replace(/\s+/g, "").toLocaleUpperCase("vi") : null;
}

function inferType(number: string) {
  if (/\/TT-/iu.test(number)) return "Thông tư";
  if (/\/NĐ-CP$/iu.test(number)) return "Nghị định";
  if (/\/QĐ-/iu.test(number)) return "Quyết định";
  if (/\/NQ-/iu.test(number)) return "Nghị quyết";
  if (/\/(?:QH|UBTVQH)\d*$/iu.test(number)) return "Luật/Nghị quyết";
  return "Văn bản pháp luật";
}

function inferIssuer(number: string) {
  if (/TT-BTC$/iu.test(number)) return "Bộ Tài chính";
  if (/NĐ-CP$/iu.test(number)) return "Chính phủ";
  return "";
}

function compactPageRanges(pages: number[]) {
  const sorted = [...new Set(pages.filter(Number.isFinite))].sort((left, right) => left - right);
  const ranges: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (let index = 1; index <= sorted.length; index += 1) {
    const current = sorted[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    if (start !== undefined && previous !== undefined) {
      ranges.push(start === previous ? String(start) : `${start}–${previous}`);
    }
    start = current;
    previous = current;
  }
  const visible = ranges.slice(0, 8);
  return `${visible.join(", ")}${ranges.length > visible.length ? ", …" : ""}`;
}

function compactWarning(value: string) {
  const match = value.match(/^Thiếu nội dung đạt yêu cầu ở trang (.+) \((\d+)\/(\d+) trang\)\.$/u);
  if (!match) return value;
  const pages = match[1]
    .split(",")
    .map((item) => Number(item.trim()))
    .filter(Number.isFinite);
  const covered = Number(match[2]);
  const total = Number(match[3]);
  const missing = Math.max(0, total - covered);
  const examples = compactPageRanges(pages);
  return `Bản nhập nền còn thiếu ${missing}/${total} trang đạt yêu cầu${examples ? `; các đoạn thiếu tiêu biểu: ${examples}` : ""}.`;
}

function compactWarnings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)).map(compactWarning)));
}

function candidate(
  number: string,
  state: DurableIngestionState | null,
  revision: DurablePublishedRevision | null,
): SearchCandidate {
  const document = revision?.document;
  const sourceUrl = document?.source_url ?? state?.sourceUrl ?? "";
  return {
    id: document?.id ?? `durable-${number.toLocaleLowerCase("vi").replace(/[^a-z0-9]+/g, "-")}`,
    number,
    title: document?.title ?? `${inferType(number)} số ${number}`,
    type: document?.type ?? inferType(number),
    issuer: document?.issuer ?? inferIssuer(number),
    issued_date: document?.issued_date ?? null,
    source_url: sourceUrl,
    source_label: document?.source_label ?? "Pipeline nhập văn bản Thuế Rõ",
    action_url: sourceUrl || null,
    action_label: sourceUrl ? "Mở nguồn công bố →" : null,
  };
}

export function responseFromDurableRecord(
  query: string,
  number: string,
  state: DurableIngestionState | null,
  revision: DurablePublishedRevision | null,
): TaxSearchResponse | null {
  const retrievedAt = new Date().toISOString();
  if (revision?.validation.accepted && revision.document.number.toLocaleUpperCase("vi") === number.toLocaleUpperCase("vi")) {
    return {
      query_normalized: number.toLocaleLowerCase("vi"),
      query_kind: "document",
      direct_answer: `Đã tìm thấy ${number} trong kho văn bản đã được nhập và kiểm tra tự động.`,
      document: revision.document,
      candidates: [],
      warnings: [],
      confidence: 0.99,
      retrieved_at: retrievedAt,
    };
  }
  if (!state) return null;

  const item = candidate(number, state, revision);
  if (state.status === "processing") {
    return {
      query_normalized: number.toLocaleLowerCase("vi"),
      query_kind: "document",
      direct_answer: `Đã xác định ${number}; hệ thống đang xử lý nền ở bước ${state.stage}. Toàn văn chỉ được hiển thị sau khi đủ trang và vượt qua kiểm tra chất lượng.`,
      document: null,
      candidates: [item],
      warnings: compactWarnings(state.warnings),
      confidence: 0.82,
      retrieved_at: retrievedAt,
    };
  }
  if (state.status === "needs_review") {
    const progress = state.totalPages > 0
      ? ` Lượt nhập gần nhất mới có ${state.processedPages}/${state.totalPages} trang đạt yêu cầu.`
      : "";
    return {
      query_normalized: number.toLocaleLowerCase("vi"),
      query_kind: "document",
      direct_answer: `Đã xác định đúng ${number}, nhưng kết quả nhập chưa đủ để công bố toàn văn.${progress} Hệ thống sẽ ưu tiên nguồn DOCX, DOC hoặc HTML có lớp chữ thay vì dùng bản OCR thiếu trang.`,
      document: null,
      candidates: [item],
      warnings: compactWarnings(state.warnings),
      confidence: 0.76,
      retrieved_at: retrievedAt,
    };
  }
  if (state.status === "failed") {
    return {
      query_normalized: number.toLocaleLowerCase("vi"),
      query_kind: "document",
      direct_answer: `Đã xác định ${number}, nhưng lượt nhập gần nhất thất bại. Hệ thống sẽ tự thử nguồn chữ khác hoặc chạy lại; chưa dùng nội dung chưa kiểm chứng làm toàn văn.`,
      document: null,
      candidates: [item],
      warnings: compactWarnings([state.error, ...state.warnings]),
      confidence: 0.58,
      retrieved_at: retrievedAt,
    };
  }
  return null;
}
