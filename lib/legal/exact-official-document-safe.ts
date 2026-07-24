import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import { discoverOfficialSources } from "./discovery.ts";
import { hasUsableLegalDocumentText, looksLikeGovernmentPortalShell } from "./document-quality.ts";
import { extractDurableLegalSource, type DurableExtractedSource } from "./durable-extraction.ts";
import { fetchDurableLegalBuffer } from "./durable-fetch.ts";
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
import { durableSourceFromDiscovery } from "./recent-tax-discovery-core.ts";
import type { DocumentDetail, OnlineLegalSource, TaxSearchResponse } from "./types.ts";

const CACHE_SECONDS = 24 * 60 * 60;
const POLICY_SITE_ORIGIN = "https://xaydungchinhsach.chinhphu.vn";
const POLICY_DISCOVERY_PAGES = [
  "/tim-kiem.htm?keywords=",
  "/tim-kiem.html?keywords=",
  "/toan-van.html?keywords=",
] as const;

function normalizeText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n[ ]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function htmlToText(value: string) {
  return normalizeText(
    decodeHtml(
      value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, " ")
        .replace(/<(?:br|hr)\b[^>]*>/giu, "\n")
        .replace(/<\/(?:p|div|li|h[1-6]|tr|section|article|blockquote|table)>/giu, "\n")
        .replace(/<\/(?:td|th)>/giu, "\t")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

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
  if (/xaydungchinhsach\.chinhphu\.vn\/(?:toan-van-|nghi-dinh-|thong-tu-|luat-)/u.test(value)) return 4;
  return 5;
}

function normalizedMention(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/ND-CP/giu, "ND-CP")
    .replace(/QD-/giu, "QD-")
    .toLocaleLowerCase("vi");
}

function containsExactNumber(value: string, number: string) {
  const expected = normalizeDocumentNumber(number);
  const candidates = value.match(
    /\b\d{1,4}\s*\/\s*20\d{2}\s*\/\s*(?:NĐ-CP|ND-CP|TT-[A-ZĐ0-9-]+|NQ-[A-ZĐ0-9-]+|QĐ-[A-ZĐa-z0-9-]+|QD-[A-Za-z0-9-]+|QH\d*|UBTVQH\d*)\b/giu,
  ) ?? [];
  if (candidates.some((candidate) => normalizeDocumentNumber(candidate) === expected)) return true;
  const normalized = normalizedMention(value);
  const slug = normalizedMention(number).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return Boolean(slug && normalized.replace(/[^a-z0-9]+/g, "-").includes(slug));
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

function safePolicyUrl(raw: string, base = POLICY_SITE_ORIGIN) {
  try {
    const url = new URL(decodeHtml(raw.trim()), base);
    const host = url.hostname.toLocaleLowerCase("en");
    if (url.protocol !== "https:" || host !== "xaydungchinhsach.chinhphu.vn") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function articleLinksFromSearchHtml(html: string, pageUrl: string, number: string) {
  const ranked: Array<{ url: string; score: number }> = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)) {
    const url = safePolicyUrl(match[1], pageUrl);
    const label = htmlToText(match[2]);
    if (!url || !containsExactNumber(`${label} ${url}`, number)) continue;
    if (!/\.htm(?:l)?(?:$|[?#])/iu.test(url)) continue;
    const normalized = normalizedMention(`${label} ${url}`);
    const score = normalized.includes("toan van") || normalized.includes("toan-van") ? 10 : 5;
    ranked.push({ url, score });
  }
  return Array.from(new Map(
    ranked
      .sort((left, right) => right.score - left.score)
      .map((item) => [item.url, item] as const),
  ).values()).map((item) => item.url);
}

async function discoverPolicyArticleUrls(number: string) {
  const encoded = encodeURIComponent(number);
  const searchPages = [
    ...POLICY_DISCOVERY_PAGES.map((path) => `${POLICY_SITE_ORIGIN}${path}${encoded}`),
    `${POLICY_SITE_ORIGIN}/toan-van.html`,
    `${POLICY_SITE_ORIGIN}/ke-khai-thue.html`,
  ];
  const urls: string[] = [];
  for (const pageUrl of searchPages) {
    try {
      const source = await fetchDurableLegalBuffer(pageUrl);
      const mime = source.response.headers.get("content-type")?.toLocaleLowerCase("en") ?? "";
      if (!mime.includes("html")) continue;
      urls.push(...articleLinksFromSearchHtml(source.buffer.toString("utf8"), source.url, number));
      if (urls.length >= 6) break;
    } catch {
      // Try the next official search/category page.
    }
  }
  return Array.from(new Set(urls)).slice(0, 8);
}

function articleTitle(html: string, number: string) {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu)?.[1];
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1];
  return htmlToText(h1 || title || "") || `Văn bản số ${number}`;
}

function articleBodyText(html: string, number: string) {
  const jsonBody = html.match(/"articleBody"\s*:\s*("(?:\\.|[^"\\])*")/iu)?.[1];
  if (jsonBody) {
    try {
      const value = normalizeText(JSON.parse(jsonBody) as string);
      if (containsExactNumber(value, number) && hasUsableLegalDocumentText(value, number)) return value;
    } catch {
      // Continue with rendered HTML.
    }
  }

  const regions = [
    ...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/giu),
    ...html.matchAll(/<(?:div|section)\b[^>]*(?:class|id)=["'][^"']*(?:detail-content|article-content|detail__content|article__body|news-content|content-detail)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/giu),
  ].map((match) => htmlToText(match[1]));

  const full = htmlToText(
    html
      .replace(/<header\b[^>]*>[\s\S]*?<\/header>/giu, " ")
      .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/giu, " ")
      .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/giu, " ")
      .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/giu, " ")
      .replace(/<form\b[^>]*>[\s\S]*?<\/form>/giu, " "),
  );
  regions.push(full);

  for (const region of regions.sort((left, right) => right.length - left.length)) {
    const normalizedExpected = normalizeDocumentNumber(number);
    const lines = region.split("\n");
    let start = lines.findIndex((line) => normalizeDocumentNumber(line).includes(normalizedExpected));
    if (start < 0) continue;
    start = Math.max(0, start - 2);
    let selected = lines.slice(start).join("\n");
    const tailSignals = [
      /\nNội dung này, đã nhận được/iu,
      /\nGóp ý, hiến kế/iu,
      /\nTừ khóa:/iu,
      /\n©\s*BÁO ĐIỆN TỬ CHÍNH PHỦ/iu,
    ];
    for (const signal of tailSignals) selected = selected.split(signal)[0];
    selected = normalizeText(selected);
    if (containsExactNumber(selected, number) && hasUsableLegalDocumentText(selected, number)) return selected;
  }
  return null;
}

async function policyArticleDocument(number: string): Promise<DocumentDetail | null> {
  const urls = await discoverPolicyArticleUrls(number);
  for (const url of urls) {
    try {
      const source = await fetchDurableLegalBuffer(url);
      const html = source.buffer.toString("utf8");
      const text = articleBodyText(html, number);
      if (!text || looksLikeGovernmentPortalShell(text)) continue;
      const validation = validateDurableLegalText({
        expectedNumber: number,
        text,
        extractionMethod: "html",
        qualityScore: 0.92,
      });
      if (!validation.accepted) continue;
      const title = articleTitle(html, number);
      const legalSource: DurableLegalSource = {
        number,
        title,
        type: inferType(number),
        issuer: inferIssuer(number),
        issuedDate: null,
        effectiveDate: null,
        officialPageUrl: url,
        sourceUrl: url,
        sourceLabel: "Cổng Thông tin điện tử Chính phủ",
      };
      const extracted: DurableExtractedSource = {
        sourceUrl: url,
        sourceBuffer: source.buffer,
        mimeType: "text/html",
        fileName: new URL(url).pathname.split("/").pop() || "official-article.html",
        officialText: text,
        sha256: createHash("sha256").update(source.buffer).digest("hex"),
        extractionMethod: "html",
        qualityScore: 0.92,
        requiresOcr: false,
        totalPages: 0,
        metadata: { articleFallback: true },
      };
      return buildDocument(legalSource, extracted);
    } catch {
      // Try the next exact official article.
    }
  }
  return null;
}

export async function discoverExactOfficialSourcesSafe(number: string) {
  const [primary, exactDiscovery, articleUrls] = await Promise.all([
    discoverExactOfficialSources(number).catch(() => []),
    Promise.all([
      discoverOfficialSources(number).catch(() => ({ sources: [], warnings: [] })),
      discoverOfficialSources(`toàn văn ${number}`).catch(() => ({ sources: [], warnings: [] })),
    ]),
    discoverPolicyArticleUrls(number),
  ]);
  const legacy = exactDiscovery.flatMap((result) => exactLegacySources(number, result.sources));
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

  const article = await policyArticleDocument(number);
  if (article) return article;

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
  ["thue-ro-exact-official-document-safe-v2"],
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
