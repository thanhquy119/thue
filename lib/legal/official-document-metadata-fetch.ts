import { unstable_cache } from "next/cache";
import {
  extractOfficialMetadataFromText,
  mergeOfficialDocumentMetadata,
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
        "user-agent": "Thuế Rõ official metadata verifier/1.0",
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
  ["thue-ro-official-document-metadata-v1"],
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

export async function enrichDocumentWithOfficialMetadata(document: DocumentDetail) {
  const locallyEnriched = mergeOfficialDocumentMetadata(document, [document]);
  const sourceUrl = locallyEnriched.source_url;
  if (!allowedOfficialUrl(sourceUrl)) return locallyEnriched;
  if (
    locallyEnriched.effective_date &&
    locallyEnriched.issued_date &&
    locallyEnriched.title.length >= 25 &&
    locallyEnriched.status !== "unknown"
  ) {
    return locallyEnriched;
  }

  const metadata = await loadOfficialMetadata(locallyEnriched.number, sourceUrl).catch(() => null);
  if (!metadata) return locallyEnriched;
  const candidate: DocumentDetail = {
    ...locallyEnriched,
    title: metadata.title ?? locallyEnriched.title,
    issued_date: metadata.issuedDate ?? locallyEnriched.issued_date,
    effective_date: metadata.effectiveDate ?? locallyEnriched.effective_date,
    status: metadata.effectiveDate
      ? metadata.effectiveDate > new Date().toISOString().slice(0, 10)
        ? "upcoming"
        : "effective"
      : locallyEnriched.status,
  };
  return mergeOfficialDocumentMetadata(locallyEnriched, [candidate]);
}
