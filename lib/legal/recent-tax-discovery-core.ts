import { normalizeDocumentNumber, type DurableLegalSource } from "./durable-ingestion-types.ts";
import { isAllowedLegalSource } from "./ingestion.ts";
import { preferredRecentDocumentDownload } from "./recent-document-definitions.ts";
import type { OnlineLegalSource } from "./types.ts";

export const CURRENT_TAX_DOCUMENT_NUMBERS = [
  "108/2025/QH15",
  "141/2026/NĐ-CP",
  "252/2026/NĐ-CP",
  "253/2026/NĐ-CP",
  "254/2026/NĐ-CP",
  "256/2026/NĐ-CP",
  "82/2026/TT-BTC",
  "87/2026/TT-BTC",
  "89/2026/TT-BTC",
  "90/2026/TT-BTC",
  "91/2026/TT-BTC",
  "93/2026/TT-BTC",
  "94/2026/TT-BTC",
  "97/2026/TT-BTC",
] as const;

export const CURRENT_TAX_DISCOVERY_QUERIES = [
  "thuế Chính phủ",
  "thuế Bộ Tài chính",
  "nghị định thuế",
  "thông tư thuế",
  "quản lý thuế",
  "đăng ký thuế",
  "hóa đơn điện tử thuế",
  "thuế thu nhập cá nhân",
  "thuế thu nhập doanh nghiệp",
  "thuế giá trị gia tăng",
  "thuế tiêu thụ đặc biệt",
  "thuế xuất khẩu nhập khẩu",
  "lệ phí môn bài",
] as const;

function inferTitle(source: OnlineLegalSource, number: string) {
  const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const title = source.title
    .replace(new RegExp(`^\\s*(?:Nghị định|Thông tư|Nghị quyết|Quyết định|Luật|Văn bản pháp luật)\\s+(?:số\\s+)?${escaped}\\s*:?\\s*`, "iu"), "")
    .trim();
  return title || source.snippet.split(/\.\s/u, 1)[0]?.trim() || `Văn bản số ${number}`;
}

function inferType(source: OnlineLegalSource, number: string) {
  if (source.document_type) return source.document_type;
  if (/\/TT-/iu.test(number)) return "Thông tư";
  if (/\/NĐ-CP$/iu.test(number)) return "Nghị định";
  if (/\/QH\d*$/iu.test(number)) return "Luật";
  if (/\/QĐ-/iu.test(number)) return "Quyết định";
  return "Văn bản pháp luật";
}

export function selectExactOfficialSource(number: string, sources: OnlineLegalSource[]) {
  const expected = normalizeDocumentNumber(number);
  return sources
    .filter((source) => source.url && normalizeDocumentNumber(source.document_number ?? "") === expected)
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

export function durableSourceFromDiscovery(number: string, source: OnlineLegalSource): DurableLegalSource {
  const preferred = preferredRecentDocumentDownload(number);
  const officialPreferred = preferred && isAllowedLegalSource(preferred.url) ? preferred : null;
  return {
    number,
    title: inferTitle(source, number),
    type: inferType(source, number),
    issuer: source.issuer || (/TT-BTC$/iu.test(number) ? "Bộ Tài chính" : /NĐ-CP$/iu.test(number) ? "Chính phủ" : ""),
    issuedDate: source.issued_date ?? null,
    effectiveDate: null,
    officialPageUrl: source.url,
    sourceUrl: officialPreferred?.url ?? source.url,
    sourceLabel: officialPreferred
      ? `${officialPreferred.label}; thuộc tính văn bản đối chiếu từ ${source.source_label}`
      : source.source_label,
  };
}
