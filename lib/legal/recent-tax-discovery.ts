import { discoverOfficialSources } from "./discovery.ts";
import { normalizeDocumentNumber, type DurableLegalSource } from "./durable-ingestion-types.ts";
import type { OnlineLegalSource } from "./types.ts";

export const CURRENT_TAX_DOCUMENT_NUMBERS = [
  "82/2026/TT-BTC",
  "87/2026/TT-BTC",
  "89/2026/TT-BTC",
  "90/2026/TT-BTC",
  "91/2026/TT-BTC",
  "93/2026/TT-BTC",
  "94/2026/TT-BTC",
  "97/2026/TT-BTC",
] as const;

function inferTitle(source: OnlineLegalSource, number: string) {
  const title = source.title.replace(new RegExp(`^\\s*(?:Thông tư|Văn bản pháp luật)\\s+(?:số\\s+)?${number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:?\\s*`, "iu"), "").trim();
  return title || source.snippet.split(/\.\s/u, 1)[0]?.trim() || `Văn bản số ${number}`;
}

function inferType(source: OnlineLegalSource, number: string) {
  if (source.document_type) return source.document_type;
  if (/\/TT-/iu.test(number)) return "Thông tư";
  if (/\/NĐ-CP$/iu.test(number)) return "Nghị định";
  if (/\/QH\d*$/iu.test(number)) return "Luật";
  return "Văn bản pháp luật";
}

export function selectExactOfficialSource(number: string, sources: OnlineLegalSource[]) {
  const expected = normalizeDocumentNumber(number);
  return sources
    .filter((source) => source.url && normalizeDocumentNumber(source.document_number ?? "") === expected)
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

export function durableSourceFromDiscovery(number: string, source: OnlineLegalSource): DurableLegalSource {
  return {
    number,
    title: inferTitle(source, number),
    type: inferType(source, number),
    issuer: source.issuer || (/TT-BTC$/iu.test(number) ? "Bộ Tài chính" : ""),
    issuedDate: source.issued_date ?? null,
    effectiveDate: null,
    officialPageUrl: source.url,
    sourceUrl: source.url,
    sourceLabel: source.source_label,
  };
}

export async function discoverTaxDocumentByNumber(number: string) {
  const discovery = await discoverOfficialSources(number);
  const exact = selectExactOfficialSource(number, discovery.sources);
  return exact ? durableSourceFromDiscovery(number, exact) : null;
}

export async function discoverRecentTaxDocuments(
  numbers: readonly string[] = CURRENT_TAX_DOCUMENT_NUMBERS,
) {
  const settled = await Promise.allSettled(numbers.map((number) => discoverTaxDocumentByNumber(number)));
  const documents: DurableLegalSource[] = [];
  const warnings: string[] = [];
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    const number = numbers[index];
    if (result.status === "fulfilled" && result.value) documents.push(result.value);
    else if (result.status === "fulfilled") warnings.push(`Không tìm thấy nguồn chính thức khớp chính xác ${number}.`);
    else warnings.push(`${number}: ${result.reason instanceof Error ? result.reason.message : "Không thể phát hiện nguồn."}`);
  }
  const seen = new Set<string>();
  return {
    documents: documents.filter((document) => {
      const key = normalizeDocumentNumber(document.number);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    warnings,
  };
}
