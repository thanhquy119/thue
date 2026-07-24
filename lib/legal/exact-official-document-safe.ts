import { unstable_cache } from "next/cache";
import { discoverOfficialSources } from "./discovery.ts";
import { hasUsableLegalDocumentText, looksLikeGovernmentPortalShell } from "./document-quality.ts";
import { extractDurableLegalSource, type DurableExtractedSource } from "./durable-extraction.ts";
import {
  normalizeDocumentNumber,
  validateDurableLegalText,
  type DurableLegalSource,
} from "./durable-ingestion-types.ts";
import {
  canonicalExactDocumentNumber,
} from "./exact-official-document-core.ts";
import {
  discoverExactOfficialSources,
  exactOfficialDocumentResponse,
  loadExactOfficialDocument,
} from "./exact-official-document-resolver.ts";
import { parseLegalHierarchy, slugifyDocument } from "./ingestion.ts";
import { durableSourceFromDiscovery } from "./recent-tax-discovery-core.ts";
import type { DocumentDetail, TaxSearchResponse } from "./types.ts";

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
  if (/xaydungchinhsach\.chinhphu\.vn\/toan-van-/u.test(value)) return 4;
  return 5;
}

function exactLegacySources(number: string, sources: Awaited<ReturnType<typeof discoverOfficialSources>>["sources"]) {
  const expected = normalizeDocumentNumber(number);
  return sources
    .filter((source) => source.url && normalizeDocumentNumber(source.document_number ?? "") === expected)
    .map((source) => durableSourceFromDiscovery(number, source));
}

export async function discoverExactOfficialSourcesSafe(number: string) {
  const [primary, discovery] = await Promise.all([
    discoverExactOfficialSources(number).catch(() => []),
    discoverOfficialSources(number).catch(() => ({ sources: [], warnings: [] })),
  ]);
  const seen = new Set<string>();
  return [...primary, ...exactLegacySources(number, discovery.sources)]
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

  const sources = await discoverExactOfficialSourcesSafe(number);
  for (const source of sources.slice(0, 16)) {
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
  ["thue-ro-exact-official-document-safe-v1"],
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
