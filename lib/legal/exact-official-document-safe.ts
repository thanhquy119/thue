import { unstable_cache } from "next/cache";
import { discoverOfficialSources } from "./discovery.ts";
import { hasUsableLegalDocumentText, looksLikeGovernmentPortalShell } from "./document-quality.ts";
import { extractDurableLegalSource, type DurableExtractedSource } from "./durable-extraction.ts";
import {
  normalizeDocumentNumber,
  validateDurableLegalText,
  type DurableLegalSource,
} from "./durable-ingestion-types.ts";
import { canonicalExactDocumentNumber } from "./exact-official-document-core.ts";
import {
  discoverExactOfficialSources,
  exactOfficialDocumentResponse,
  loadExactOfficialDocument,
} from "./exact-official-document-resolver.ts";
import { parseLegalHierarchy, slugifyDocument } from "./ingestion.ts";
import {
  discoverPolicyFullTextUrls,
  loadPolicyFullTextDocument,
} from "./policy-fulltext.ts";
import { durableSourceFromDiscovery } from "./recent-tax-discovery-core.ts";
import type { DocumentDetail, OnlineLegalSource, TaxSearchResponse } from "./types.ts";

const CACHE_SECONDS = 24 * 60 * 60;

function sourcePriority(url: string) {
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    // Keep the encoded URL.
  }
  const value = decoded.toLocaleLowerCase("en");
  if (/\.docx(?:$|[?&#])/u.test(value)) return 0;
  if (/\.doc(?:$|[?&#])/u.test(value)) return 1;
  if (/\.pdf(?:$|[?&#])/u.test(value)) return 2;
  if (/\b(?:download|stream|attachment)\b/u.test(value)) return 3;
  if (/xaydungchinhsach\.chinhphu\.vn\//u.test(value)) return 4;
  return 5;
}

function normalizedMention(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi");
}

function containsExactNumber(value: string, number: string) {
  const expected = normalizeDocumentNumber(number);
  const candidates = value.match(
    /\b\d{1,4}\s*\/\s*20\d{2}\s*\/\s*(?:NĐ-CP|ND-CP|TT-[A-ZĐ0-9-]+|NQ-[A-ZĐ0-9-]+|QĐ-[A-ZĐa-z0-9-]+|QD-[A-Za-z0-9-]+|QH\d*|UBTVQH\d*)\b/giu,
  ) ?? [];
  if (candidates.some((candidate) => normalizeDocumentNumber(candidate) === expected)) return true;
  const normalized = normalizedMention(value).replace(/[^a-z0-9]+/g, "-");
  const slug = normalizedMention(number).replace(/[^a-z0-9]+/g, "-");
  return normalized.includes(slug);
}

function exactLegacySources(number: string, sources: OnlineLegalSource[]) {
  return sources
    .filter((source) =>
      Boolean(source.url) &&
      containsExactNumber(`${source.document_number ?? ""} ${source.title} ${source.snippet} ${source.url}`, number),
    )
    .map((source) => durableSourceFromDiscovery(number, source));
}

function inferType(number: string) {
  if (/\/NĐ-CP$/iu.test(number)) return "Nghị định";
  if (/\/TT-/iu.test(number)) return "Thông tư";
  if (/\/NQ-/iu.test(number)) return "Nghị quyết";
  if (/\/QĐ-/iu.test(number)) return "Quyết định";
  if (/\/(?:QH|UBTVQH)\d*$/iu.test(number)) return "Luật";
  return "Văn bản pháp luật";
}

function inferIssuer(number: string) {
  if (/TT-BTC$/iu.test(number)) return "Bộ Tài chính";
  if (/NĐ-CP$/iu.test(number) || /NQ-CP$/iu.test(number)) return "Chính phủ";
  if (/QĐ-TTg$/iu.test(number)) return "Thủ tướng Chính phủ";
  if (/\/(?:QH|UBTVQH)\d*$/iu.test(number)) return "Quốc hội";
  return "";
}

export async function discoverExactOfficialSourcesSafe(number: string) {
  const [primary, discoveries, articleUrls] = await Promise.all([
    discoverExactOfficialSources(number).catch(() => []),
    Promise.all([
      discoverOfficialSources(number).catch(() => ({ sources: [], warnings: [] })),
      discoverOfficialSources(`toàn văn ${number}`).catch(() => ({ sources: [], warnings: [] })),
    ]),
    discoverPolicyFullTextUrls(number),
  ]);
  const legacy = discoveries.flatMap((result) => exactLegacySources(number, result.sources));
  const articleSources: DurableLegalSource[] = articleUrls.map((url) => ({
    number,
    title: `Toàn văn ${number}`,
    type: inferType(number),
    issuer: inferIssuer(number),
    issuedDate: null,
    effectiveDate: null,
    officialPageUrl: url,
    sourceUrl: url,
    sourceLabel: "Cổng Thông tin điện tử Chính phủ",
  }));
  const seen = new Set<string>();
  return [...primary, ...legacy, ...articleSources]
    .filter((source) => {
      if (!source.sourceUrl || seen.has(source.sourceUrl)) return false;
      seen.add(source.sourceUrl);
      return true;
    })
    .sort((left, right) => sourcePriority(left.sourceUrl) - sourcePriority(right.sourceUrl));
}

function inferStatus(effectiveDate: string | null) {
  if (!effectiveDate) return "unknown" as const;
  return effectiveDate > new Date().toISOString().slice(0, 10) ? "upcoming" as const : "effective" as const;
}

function buildDocument(source: DurableLegalSource, extracted: DurableExtractedSource): DocumentDetail {
  const provisions = parseLegalHierarchy(extracted.officialText).map((provision, index) => ({
    id: `${slugifyDocument(source.number)}-${index}`,
    type: provision.provisionType,
    identifier: provision.identifier,
    article: provision.article,
    heading: provision.heading,
    official_text: provision.officialText,
    order_index: provision.orderIndex,
  }));
  return {
    id: slugifyDocument(`${source.number}-${source.sourceUrl}`),
    number: source.number,
    title: source.title,
    type: source.type,
    issuer: source.issuer || "Đang đối chiếu",
    issued_date: source.issuedDate,
    effective_date: source.effectiveDate,
    status: inferStatus(source.effectiveDate),
    source_url: source.officialPageUrl || source.sourceUrl,
    source_label: source.sourceLabel,
    last_verified_at: new Date().toISOString(),
    extraction_method: extracted.extractionMethod,
    quality_score: extracted.qualityScore,
    verification_notes: null,
    official_text: extracted.officialText,
    provisions,
  };
}

async function loadSafeUncached(number: string) {
  const primary = await loadExactOfficialDocument(number).catch(() => null);
  if (primary) return primary;

  const policyArticle = await loadPolicyFullTextDocument(number);
  if (policyArticle) return policyArticle;

  const sources = await discoverExactOfficialSourcesSafe(number);
  for (const source of sources.slice(0, 20)) {
    try {
      const extracted = await extractDurableLegalSource(source.sourceUrl);
      if (extracted.requiresOcr || looksLikeGovernmentPortalShell(extracted.officialText)) continue;
      const validation = validateDurableLegalText({
        expectedNumber: source.number,
        issuedDate: source.issuedDate,
        text: extracted.officialText,
        extractionMethod: extracted.extractionMethod,
        qualityScore: extracted.qualityScore,
      });
      if (!validation.accepted || !hasUsableLegalDocumentText(extracted.officialText, source.number)) continue;
      return buildDocument(source, extracted);
    } catch {
      // Continue to the next exact official source.
    }
  }
  return null;
}

const loadSafeCached = unstable_cache(
  loadSafeUncached,
  ["thue-ro-exact-official-document-safe-v3"],
  { revalidate: CACHE_SECONDS, tags: ["official-legal-documents"] },
);

function incrementalCacheUnavailable(error: unknown) {
  return error instanceof Error && /incrementalcache\s+missing/iu.test(error.message);
}

export async function loadExactOfficialDocumentSafe(number: string) {
  const normalized = number.replace(/ND-CP/giu, "NĐ-CP").replace(/QD-/giu, "QĐ-");
  try {
    return await loadSafeCached(normalized);
  } catch (error) {
    if (!incrementalCacheUnavailable(error)) throw error;
    return loadSafeUncached(normalized);
  }
}

export async function exactOfficialDocumentResponseSafe(query: string): Promise<TaxSearchResponse | null> {
  const number = canonicalExactDocumentNumber(query);
  if (!number) return null;

  const primary = await exactOfficialDocumentResponse(query);
  if (primary?.document) return primary;

  const document = await loadExactOfficialDocumentSafe(number);
  if (!document) return primary;
  return {
    query_normalized: normalizeDocumentNumber(number),
    query_kind: "document",
    direct_answer: `Đã tìm thấy ${document.number}.`,
    document,
    candidates: [],
    warnings: [],
    confidence: 0.99,
    retrieved_at: new Date().toISOString(),
  };
}
