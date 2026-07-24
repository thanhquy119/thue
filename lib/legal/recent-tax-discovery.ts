import { discoverOfficialSources } from "./discovery.ts";
import { discoverExactOfficialSources } from "./exact-official-document.ts";
import { normalizeDocumentNumber, type DurableLegalSource } from "./durable-ingestion-types.ts";
import {
  CURRENT_TAX_DISCOVERY_QUERIES,
  CURRENT_TAX_DOCUMENT_NUMBERS,
  durableSourceFromDiscovery,
  selectExactOfficialSource,
} from "./recent-tax-discovery-core.ts";
import type { OnlineLegalSource } from "./types.ts";

export {
  CURRENT_TAX_DISCOVERY_QUERIES,
  CURRENT_TAX_DOCUMENT_NUMBERS,
  durableSourceFromDiscovery,
  selectExactOfficialSource,
} from "./recent-tax-discovery-core.ts";

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

export async function discoverTaxDocumentByNumber(number: string) {
  const exactGazette = await discoverExactOfficialSources(number).catch(() => []);
  if (exactGazette.length) return exactGazette[0];

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
