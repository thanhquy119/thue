import { createHash } from "node:crypto";
import { hasUsableLegalDocumentText, looksLikeGovernmentPortalShell } from "./document-quality.ts";
import { fetchDurableLegalBuffer } from "./durable-fetch.ts";
import { normalizeDocumentNumber, validateDurableLegalText, type DurableLegalSource } from "./durable-ingestion-types.ts";
import { extractOfficialAttachmentUrls } from "./exact-official-document-core.ts";
import { parseLegalHierarchy, slugifyDocument } from "./ingestion.ts";
import type { DocumentDetail } from "./types.ts";

const ORIGIN = "https://xaydungchinhsach.chinhphu.vn";
const DISCOVERY_PAGES = [
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

function safeUrl(raw: string, base = ORIGIN) {
  try {
    const url = new URL(decodeHtml(raw.trim()), base);
    return url.protocol === "https:" && url.hostname === "xaydungchinhsach.chinhphu.vn"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function articleLinks(html: string, pageUrl: string, number: string) {
  const ranked: Array<{ url: string; score: number }> = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)) {
    const url = safeUrl(match[1], pageUrl);
    const label = htmlToText(match[2]);
    if (!url || !containsExactNumber(`${label} ${url}`, number)) continue;
    if (!/\.htm(?:l)?(?:$|[?#])/iu.test(url)) continue;
    const signal = normalizedMention(`${label} ${url}`);
    ranked.push({ url, score: /toan[ -]van/u.test(signal) ? 10 : 5 });
  }
  const seen = new Set<string>();
  return ranked
    .sort((left, right) => right.score - left.score)
    .map((item) => item.url)
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
}

export async function discoverPolicyFullTextUrls(number: string) {
  const encoded = encodeURIComponent(number);
  const pages = [
    ...DISCOVERY_PAGES.map((path) => `${ORIGIN}${path}${encoded}`),
    `${ORIGIN}/toan-van.html`,
    `${ORIGIN}/ke-khai-thue.html`,
  ];
  const urls: string[] = [];
  for (const pageUrl of pages) {
    try {
      const source = await fetchDurableLegalBuffer(pageUrl);
      const mime = source.response.headers.get("content-type")?.toLocaleLowerCase("en") ?? "";
      if (!mime.includes("html")) continue;
      urls.push(...articleLinks(source.buffer.toString("utf8"), source.url, number));
      if (urls.length >= 8) break;
    } catch {
      // Try the next official search/category page.
    }
  }
  return Array.from(new Set(urls)).slice(0, 10);
}

function attachmentPriority(url: string) {
  const value = (() => {
    try {
      return decodeURIComponent(url).toLocaleLowerCase("en");
    } catch {
      return url.toLocaleLowerCase("en");
    }
  })();
  if (/\.docx(?:$|[?&#])/u.test(value)) return 0;
  if (/\.doc(?:$|[?&#])/u.test(value)) return 1;
  if (/\.pdf(?:$|[?&#])/u.test(value)) return 2;
  return 3;
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

function titleFromHtml(html: string, number: string) {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/iu)?.[1];
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1];
  return htmlToText(h1 || title || "") || `Văn bản số ${number}`;
}

export async function discoverPolicyAttachmentSources(number: string) {
  const articleUrls = await discoverPolicyFullTextUrls(number);
  const sources: DurableLegalSource[] = [];
  for (const articleUrl of articleUrls) {
    try {
      const fetched = await fetchDurableLegalBuffer(articleUrl);
      const html = fetched.buffer.toString("utf8");
      const title = titleFromHtml(html, number);
      const attachments = extractOfficialAttachmentUrls(html, fetched.url)
        .filter((url) => /\.(?:docx?|pdf)(?:$|[?&#])/iu.test(url))
        .sort((left, right) => attachmentPriority(left) - attachmentPriority(right));
      for (const sourceUrl of attachments) {
        sources.push({
          number,
          title,
          type: inferType(number),
          issuer: inferIssuer(number),
          issuedDate: null,
          effectiveDate: null,
          officialPageUrl: articleUrl,
          sourceUrl,
          sourceLabel: "Cổng Thông tin điện tử Chính phủ",
        });
      }
    } catch {
      // Try the next exact official article.
    }
  }
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.sourceUrl)) return false;
    seen.add(source.sourceUrl);
    return true;
  });
}

function trimArticleCandidate(value: string, number: string) {
  const lines = normalizeText(value).split("\n");
  const expected = normalizeDocumentNumber(number);
  const positions = lines
    .map((line, index) => normalizeDocumentNumber(line).includes(expected) ? index : -1)
    .filter((index) => index >= 0);
  if (!positions.length) return null;

  let best: string | null = null;
  for (const position of positions.slice(0, 8)) {
    let selected = lines.slice(Math.max(0, position - 2)).join("\n");
    for (const signal of [
      /\nNội dung này, đã nhận được/iu,
      /\nGóp ý, hiến kế/iu,
      /\nTừ khóa:/iu,
      /\n©\s*BÁO ĐIỆN TỬ CHÍNH PHỦ/iu,
    ]) {
      selected = selected.split(signal)[0];
    }
    selected = normalizeText(selected);
    if (!containsExactNumber(selected, number)) continue;
    if (!best || candidateScore(selected) > candidateScore(best)) best = selected;
  }
  return best;
}

function candidateScore(value: string) {
  const articles = value.match(/^\s*Điều\s+\d+[a-zA-Z]?\b/gimu)?.length ?? 0;
  const chapters = value.match(/^\s*Chương\s+[IVXLC\d]+\b/gimu)?.length ?? 0;
  const clauses = value.match(/^\s*\d+\.\s+/gmu)?.length ?? 0;
  return articles * 1_000_000 + chapters * 100_000 + clauses * 1_000 + Math.min(value.length, 999_999);
}

export function extractCompletePolicyArticleText(html: string, number: string) {
  const rawCandidates: string[] = [];
  const jsonBody = html.match(/"articleBody"\s*:\s*("(?:\\.|[^"\\])*")/iu)?.[1];
  if (jsonBody) {
    try {
      rawCandidates.push(JSON.parse(jsonBody) as string);
    } catch {
      // Continue with rendered HTML.
    }
  }
  rawCandidates.push(
    ...[...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/giu)].map((match) => htmlToText(match[1])),
  );
  rawCandidates.push(
    ...[...html.matchAll(/<(?:div|section)\b[^>]*(?:class|id)=["'][^"']*(?:detail-content|article-content|detail__content|article__body|news-content|content-detail)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/giu)]
      .map((match) => htmlToText(match[1])),
  );
  rawCandidates.push(htmlToText(
    html
      .replace(/<header\b[^>]*>[\s\S]*?<\/header>/giu, " ")
      .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/giu, " ")
      .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/giu, " ")
      .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/giu, " ")
      .replace(/<form\b[^>]*>[\s\S]*?<\/form>/giu, " "),
  ));

  const candidates = rawCandidates
    .map((value) => trimArticleCandidate(value, number))
    .filter((value): value is string => Boolean(value))
    .filter((value) => hasUsableLegalDocumentText(value, number))
    .sort((left, right) => candidateScore(right) - candidateScore(left));
  return candidates[0] ?? null;
}

export async function loadPolicyFullTextDocument(number: string): Promise<DocumentDetail | null> {
  const urls = await discoverPolicyFullTextUrls(number);
  for (const url of urls) {
    try {
      const source = await fetchDurableLegalBuffer(url);
      const html = source.buffer.toString("utf8");
      const text = extractCompletePolicyArticleText(html, number);
      if (!text || looksLikeGovernmentPortalShell(text)) continue;
      const validation = validateDurableLegalText({
        expectedNumber: number,
        text,
        extractionMethod: "html",
        qualityScore: 0.94,
      });
      if (!validation.accepted) continue;

      const provisions = parseLegalHierarchy(text).map((provision, index) => ({
        id: `${slugifyDocument(number)}-${index}`,
        type: provision.provisionType,
        identifier: provision.identifier,
        article: provision.article,
        heading: provision.heading,
        official_text: provision.officialText,
        order_index: provision.orderIndex,
      }));
      if (!provisions.some((provision) => provision.type === "article")) continue;

      return {
        id: slugifyDocument(`${number}-${url}`),
        number,
        title: titleFromHtml(html, number),
        type: inferType(number),
        issuer: inferIssuer(number),
        issued_date: null,
        effective_date: null,
        status: "unknown",
        source_url: url,
        source_label: "Cổng Thông tin điện tử Chính phủ",
        last_verified_at: new Date().toISOString(),
        extraction_method: "html",
        quality_score: 0.94,
        verification_notes: null,
        official_text: text,
        provisions,
      };
    } catch {
      // Try the next exact official article.
    }
  }
  return null;
}

export function policyArticleFingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
