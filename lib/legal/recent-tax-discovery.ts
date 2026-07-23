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

export const CURRENT_TAX_DISCOVERY_QUERIES = [
  "thuế Bộ Tài chính",
  "quản lý thuế",
  "đăng ký thuế",
  "hóa đơn điện tử thuế",
  "thuế thu nhập cá nhân",
  "thuế giá trị gia tăng",
] as const;

function inferTitle(source: OnlineLegalSource, number: string) {
  const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const title = source.title
    .replace(new RegExp(`^\\s*(?:Thông tư|Văn bản pháp luật)\\s+(?:số\\s+)?${escaped}\\s*:?\\s*`, "iu"), "")
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

function recentCutoff(days = 120) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff.toISOString().slice(0, 10);
}

function taxRelevant(source: OnlineLegalSource) {
  const number = source.document_number ?? "";
  const normalized = `${source.title} ${source.snippet} ${source.issuer ?? ""} ${number}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi");
  const issuerMatch = /tt-btc$/iu.test(number) || normalized.includes("bo tai chinh") || normalized.includes("chinh phu");
  const topicMatch = /\b(?:thue|hoa don|hai quan|mien thue|tem dien tu|quan ly rui ro)\b/u.test(normalized);
  return issuerMatch && topicMatch;
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

async function discoverBroadTaxDocuments() {
  const year = new Date().getUTCFullYear();
  const settled = await Promise.allSettled(
    CURRENT_TAX_DISCOVERY_QUERIES.map((query) => discoverOfficialSources(`${query} ${year}`)),
  );
  const cutoff = recentCutoff();
  const sources = settled
    .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof discoverOfficialSources>>> => result.status === "fulfilled")
    .flatMap((result) => result.value.sources)
    .filter((source) => {
      const number = source.document_number?.trim() ?? "";
      if (!number || !source.url || !taxRelevant(source)) return false;
      if (!source.issued_date) return number.includes(`/${year}/`);
      return source.issued_date >= cutoff;
    });
  const byNumber = new Map<string, OnlineLegalSource>();
  for (const source of sources) {
    const number = source.document_number?.trim() ?? "";
    const key = normalizeDocumentNumber(number);
    const previous = byNumber.get(key);
    if (!previous || source.score > previous.score) byNumber.set(key, source);
  }
  return [...byNumber.values()].map((source) => durableSourceFromDiscovery(source.document_number as string, source));
}

export async function discoverRecentTaxDocuments(
  numbers: readonly string[] = CURRENT_TAX_DOCUMENT_NUMBERS,
) {
  const [exactSettled, broadSettled] = await Promise.all([
    Promise.allSettled(numbers.map((number) => discoverTaxDocumentByNumber(number))),
    discoverBroadTaxDocuments().then(
      (documents) => ({ status: "fulfilled" as const, value: documents }),
      (reason) => ({ status: "rejected" as const, reason }),
    ),
  ]);
  const documents: DurableLegalSource[] = [];
  const warnings: string[] = [];
  for (let index = 0; index < exactSettled.length; index += 1) {
    const result = exactSettled[index];
    const number = numbers[index];
    if (result.status === "fulfilled" && result.value) documents.push(result.value);
    else if (result.status === "fulfilled") warnings.push(`Không tìm thấy nguồn chính thức khớp chính xác ${number}.`);
    else warnings.push(`${number}: ${result.reason instanceof Error ? result.reason.message : "Không thể phát hiện nguồn."}`);
  }
  if (broadSettled.status === "fulfilled") documents.push(...broadSettled.value);
  else warnings.push(`Phát hiện văn bản mới: ${broadSettled.reason instanceof Error ? broadSettled.reason.message : "không thành công"}.`);

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
