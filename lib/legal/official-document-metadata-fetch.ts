import { unstable_cache } from "next/cache";
import type { DurableLegalSource } from "./durable-ingestion-types.ts";
import {
  extractOfficialMetadataFromText,
  mergeOfficialDocumentMetadata,
  type OfficialDocumentMetadata,
} from "./official-document-metadata.ts";
import type { DocumentDetail } from "./types.ts";

const CACHE_SECONDS = 7 * 24 * 60 * 60;
const OFFICIAL_HOSTS = [
  "congbao.chinhphu.vn",
  "vanban.chinhphu.vn",
  "chinhphu.vn",
  "mof.gov.vn",
  "gdt.gov.vn",
] as const;

function allowedOfficialUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return OFFICIAL_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (_match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLocaleLowerCase("en")] ?? `&${entity};`;
  });
}

function htmlToMetadataText(html: string) {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/td|\/th|\/h[1-6])>/giu, " | ")
      .replace(/<[^>]+>/gu, " "),
  )
    .replace(/\s+/gu, " ")
    .trim();
}

async function loadOfficialMetadataUncached(number: string, sourceUrl: string) {
  if (!allowedOfficialUrl(sourceUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(sourceUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "user-agent": "Thuế Rõ official metadata verifier/2.0",
        "accept-language": "vi-VN,vi;q=0.9",
      },
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type")?.toLocaleLowerCase("en") ?? "";
    if (!contentType.includes("html")) return null;
    const html = await response.text();
    if (html.length < 200 || html.length > 5_000_000) return null;
    return extractOfficialMetadataFromText(htmlToMetadataText(html), number);
  } finally {
    clearTimeout(timer);
  }
}

const loadOfficialMetadataCached = unstable_cache(
  loadOfficialMetadataUncached,
  ["thue-ro-official-document-metadata-v2"],
  { revalidate: CACHE_SECONDS, tags: ["official-legal-metadata"] },
);

async function discoverOfficialSourcesUncached(number: string) {
  const { discoverExactGazetteSources } = await import("./exact-official-document-resolver.ts");
  return discoverExactGazetteSources(number);
}

const discoverOfficialSourcesCached = unstable_cache(
  discoverOfficialSourcesUncached,
  ["thue-ro-official-document-source-resolution-v1"],
  { revalidate: CACHE_SECONDS, tags: ["official-legal-metadata"] },
);

function incrementalCacheUnavailable(error: unknown) {
  return error instanceof Error && /incrementalcache\s+missing/iu.test(error.message);
}

async function loadOfficialMetadata(number: string, sourceUrl: string) {
  try {
    return await loadOfficialMetadataCached(number, sourceUrl);
  } catch (error) {
    if (!incrementalCacheUnavailable(error)) throw error;
    return loadOfficialMetadataUncached(number, sourceUrl);
  }
}

async function discoverOfficialSources(number: string) {
  try {
    return await discoverOfficialSourcesCached(number);
  } catch (error) {
    if (!incrementalCacheUnavailable(error)) throw error;
    return discoverOfficialSourcesUncached(number);
  }
}

function statusFromDate(effectiveDate: string | null) {
  if (!effectiveDate) return "unknown" as const;
  return effectiveDate > new Date().toISOString().slice(0, 10) ? "upcoming" as const : "effective" as const;
}

function metadataCandidate(
  document: DocumentDetail,
  metadata: OfficialDocumentMetadata,
  sourceUrl = document.source_url,
  sourceLabel = document.source_label,
): DocumentDetail {
  const effectiveDate = metadata.effectiveDate ?? document.effective_date;
  return {
    ...document,
    title: metadata.title ?? document.title,
    issued_date: metadata.issuedDate ?? document.issued_date,
    effective_date: effectiveDate,
    status: statusFromDate(effectiveDate),
    source_url: sourceUrl,
    source_label: sourceLabel,
  };
}

function sourceCandidate(document: DocumentDetail, source: DurableLegalSource): DocumentDetail {
  const effectiveDate = source.effectiveDate ?? document.effective_date;
  return {
    ...document,
    title: source.title || document.title,
    type: source.type || document.type,
    issuer: source.issuer || document.issuer,
    issued_date: source.issuedDate ?? document.issued_date,
    effective_date: effectiveDate,
    status: statusFromDate(effectiveDate),
    source_url: source.officialPageUrl || source.sourceUrl || document.source_url,
    source_label: source.sourceLabel || document.source_label,
  };
}

export function mergeDocumentWithOfficialSources(
  document: DocumentDetail,
  sources: DurableLegalSource[],
) {
  return mergeOfficialDocumentMetadata(
    document,
    sources.map((source) => sourceCandidate(document, source)),
  );
}

function completeMetadata(document: DocumentDetail) {
  return Boolean(
    document.effective_date &&
      document.issued_date &&
      document.title.length >= 25 &&
      document.status !== "unknown",
  );
}

export async function enrichDocumentWithOfficialMetadata(document: DocumentDetail) {
  const locallyEnriched = mergeOfficialDocumentMetadata(document, [document]);
  if (completeMetadata(locallyEnriched)) return locallyEnriched;

  const [directMetadata, officialSources] = await Promise.all([
    allowedOfficialUrl(locallyEnriched.source_url)
      ? loadOfficialMetadata(locallyEnriched.number, locallyEnriched.source_url).catch(() => null)
      : Promise.resolve(null),
    discoverOfficialSources(locallyEnriched.number).catch(() => []),
  ]);

  const initialCandidates: DocumentDetail[] = [];
  if (directMetadata) initialCandidates.push(metadataCandidate(locallyEnriched, directMetadata));
  initialCandidates.push(...officialSources.map((source) => sourceCandidate(locallyEnriched, source)));

  let enriched = mergeOfficialDocumentMetadata(locallyEnriched, initialCandidates);
  if (completeMetadata(enriched)) return enriched;

  const canonicalPages = Array.from(
    new Set(
      officialSources
        .map((source) => source.officialPageUrl)
        .filter((url) => allowedOfficialUrl(url) && url !== locallyEnriched.source_url),
    ),
  ).slice(0, 3);
  const pageMetadata = await Promise.all(
    canonicalPages.map(async (url) => ({
      url,
      metadata: await loadOfficialMetadata(enriched.number, url).catch(() => null),
    })),
  );
  const pageCandidates = pageMetadata
    .filter((item): item is { url: string; metadata: OfficialDocumentMetadata } => item.metadata !== null)
    .map((item) => metadataCandidate(enriched, item.metadata, item.url, "Nguồn thuộc tính chính thức"));

  enriched = mergeOfficialDocumentMetadata(enriched, pageCandidates);
  return enriched;
}
