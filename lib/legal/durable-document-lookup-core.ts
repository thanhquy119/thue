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

function candidate(
  number: string,
  state: DurableIngestionState | null,
  revision: DurablePublishedRevision | null,
): SearchCandidate {
  const document = revision?.document;
  return {
    id: document?.id ?? `durable-${number.toLocaleLowerCase("vi").replace(/[^a-z0-9]+/g, "-")}`,
    number,
    title: document?.title ?? `${inferType(number)} số ${number}`,
    type: document?.type ?? inferType(number),
    issuer: document?.issuer ?? inferIssuer(number),
    issued_date: document?.issued_date ?? null,
    source_url: document?.source_url ?? state?.sourceUrl ?? "",
    source_label: document?.source_label ?? "Pipeline nhập văn bản Thuế Rõ",
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
      warnings: state.warnings,
      confidence: 0.82,
      retrieved_at: retrievedAt,
    };
  }
  if (state.status === "needs_review") {
    return {
      query_normalized: number.toLocaleLowerCase("vi"),
      query_kind: "document",
      direct_answer: `Đã xác định đúng ${number}, nhưng kết quả nhập chưa đạt ngưỡng tự động công bố và đang cần kiểm tra ngoại lệ.`,
      document: null,
      candidates: [item],
      warnings: state.warnings,
      confidence: 0.76,
      retrieved_at: retrievedAt,
    };
  }
  if (state.status === "failed") {
    return {
      query_normalized: number.toLocaleLowerCase("vi"),
      query_kind: "document",
      direct_answer: `Đã xác định ${number}, nhưng lượt nhập gần nhất thất bại. Hệ thống sẽ tự thử lại; chưa dùng nội dung chưa kiểm chứng làm toàn văn.`,
      document: null,
      candidates: [item],
      warnings: [state.error, ...state.warnings].filter((value): value is string => Boolean(value)),
      confidence: 0.58,
      retrieved_at: retrievedAt,
    };
  }
  return null;
}
