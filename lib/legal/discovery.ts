import { createHash } from "node:crypto";
import { isAllowedLegalSource } from "./ingestion";
import type { OnlineLegalSource } from "./types";

export type OfficialSourceDiscovery = {
  draft_answer: string;
  sources: OnlineLegalSource[];
};

const SEARCH_DOMAINS = [
  "vbpl.vn",
  "congbao.chinhphu.vn",
  "vanban.chinhphu.vn",
  "vbpq.mof.gov.vn",
  "gdt.gov.vn",
  "mof.gov.vn",
  "moj.gov.vn",
];

function decodeXml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return value
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
      if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      return named[entity.toLocaleLowerCase("en")] ?? `&${entity};`;
    })
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceLabel(url: string) {
  const host = new URL(url).hostname.toLocaleLowerCase("en");
  if (host.endsWith("chinhphu.vn")) return "Cổng Thông tin điện tử Chính phủ";
  if (host.endsWith("mof.gov.vn")) return "Bộ Tài chính";
  if (host.endsWith("gdt.gov.vn")) return "Cục Thuế";
  if (host.endsWith("moj.gov.vn")) return "Bộ Tư pháp";
  if (host.endsWith("vbpl.vn")) return "Cơ sở dữ liệu quốc gia về pháp luật";
  return host.replace(/^www\./, "");
}

function textBetween(item: string, tag: string) {
  return item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "";
}

function decodeBingRedirect(url: URL) {
  if (!url.hostname.toLocaleLowerCase("en").endsWith("bing.com") || !url.pathname.startsWith("/ck/a")) {
    return null;
  }
  const encoded = url.searchParams.get("u");
  if (!encoded) return null;
  try {
    return Buffer.from(encoded.startsWith("a1") ? encoded.slice(2) : encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function normalizeOfficialUrl(rawValue: string) {
  let value = decodeXml(rawValue).trim();
  if (!value) return null;
  if (value.startsWith("//")) value = `https:${value}`;

  try {
    let url = new URL(value);
    const duckTarget =
      url.hostname.toLocaleLowerCase("en").endsWith("duckduckgo.com") && url.pathname.startsWith("/l/")
        ? url.searchParams.get("uddg")
        : null;
    const bingTarget = decodeBingRedirect(url);
    if (duckTarget || bingTarget) url = new URL(duckTarget || bingTarget || value);

    if (url.protocol === "http:") url.protocol = "https:";

    // Search engines often return the properties/history tab of VBPL. The
    // ItemID is the same, so point it at the full-text tab before extraction.
    if (
      url.hostname.toLocaleLowerCase("en").endsWith("vbpl.vn") &&
      url.searchParams.has("ItemID") &&
      /\/Pages\/vbpq-(?:thuoctinh|lichsu|luocdo|van-ban-goc|pdf|vanbanhopnhat)\.aspx/iu.test(url.pathname)
    ) {
      url.pathname = url.pathname.replace(
        /vbpq-(?:thuoctinh|lichsu|luocdo|van-ban-goc|pdf|vanbanhopnhat)\.aspx/iu,
        "vbpq-toanvan.aspx",
      );
    }

    const normalized = url.toString();
    return isAllowedLegalSource(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function makeSource(url: string, title: string, snippet: string, index: number, prefix: string): OnlineLegalSource {
  return {
    id: `${prefix}-${createHash("sha256").update(url).digest("hex").slice(0, 20)}`,
    title: title || sourceLabel(url),
    url,
    snippet: snippet || "Nguồn pháp luật chính thức được tìm thấy.",
    score: Math.max(0.42, 0.92 - index * 0.025),
    source_label: sourceLabel(url),
    previewable: true,
  };
}

function parseBingRss(xml: string): OnlineLegalSource[] {
  const sources: OnlineLegalSource[] = [];
  for (const [index, match] of [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].entries()) {
    const item = match[1];
    const title = decodeXml(textBetween(item, "title"));
    const url = normalizeOfficialUrl(textBetween(item, "link"));
    const snippet = decodeXml(textBetween(item, "description"));
    if (url) sources.push(makeSource(url, title, snippet, index, "rss"));
  }
  return sources;
}

function parseSearchHtml(html: string, prefix: string): OnlineLegalSource[] {
  const sources: OnlineLegalSource[] = [];
  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)];
  for (const match of anchors) {
    const url = normalizeOfficialUrl(match[1]);
    if (!url || sources.some((source) => source.url === url)) continue;
    const title = decodeXml(match[2]);
    sources.push(makeSource(url, title, "Kết quả tìm kiếm từ nguồn công khai.", sources.length, prefix));
    if (sources.length >= 20) break;
  }
  return sources;
}

async function fetchText(url: URL, accept: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        accept,
        "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      },
    });
    return response.ok ? await response.text() : "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function searchBingRss(query: string) {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("format", "rss");
  url.searchParams.set("count", "20");
  url.searchParams.set("q", query);
  return parseBingRss(await fetchText(url, "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8"));
}

async function searchBingHtml(query: string) {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("count", "20");
  url.searchParams.set("q", query);
  return parseSearchHtml(await fetchText(url, "text/html,application/xhtml+xml"), "bing");
}

async function searchDuckDuckGo(query: string) {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  return parseSearchHtml(await fetchText(url, "text/html,application/xhtml+xml"), "ddg");
}

function documentNumberHint(query: string) {
  return (
    query.match(
      /\b\d{1,4}\s*\/\s*20\d{2}\s*\/\s*(?:NĐ-CP|ND-CP|TT-[A-ZĐ]+|NQ-[A-ZĐ0-9]+|QĐ-[A-ZĐa-z]+|QD-[A-Za-z]+|QH\d*|UBTVQH\d*)\b/iu,
    )?.[0] ?? query
  )
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueSources(batches: OnlineLegalSource[][]) {
  return batches
    .flat()
    .filter((source, index, all) => all.findIndex((candidate) => candidate.url === source.url) === index)
    .slice(0, 18);
}

export async function discoverOfficialSources(query: string): Promise<OfficialSourceDiscovery> {
  const hint = documentNumberHint(query);
  const quoted = `"${hint}"`;
  const searches = SEARCH_DOMAINS.map((domain) => `${quoted} site:${domain}`);

  let sources = uniqueSources(await Promise.all(searches.map(searchBingRss)));

  if (!sources.length) {
    const fallbackQueries = searches.slice(0, 5);
    const fallback = await Promise.all(
      fallbackQueries.flatMap((search) => [searchBingHtml(search), searchDuckDuckGo(search)]),
    );
    sources = uniqueSources(fallback);
  }

  if (!sources.length && hint !== query.trim()) {
    sources = uniqueSources(await Promise.all([searchBingHtml(query), searchDuckDuckGo(query)]));
  }

  if (!sources.length) {
    throw new Error(
      "Chưa tìm thấy nguồn pháp luật chính thức có thể mở. Văn bản có thể chưa được ban hành, nhập sai cơ quan ban hành hoặc chưa được công cụ tìm kiếm lập chỉ mục.",
    );
  }

  return {
    draft_answer: "Đã tìm thấy nguồn pháp luật chính thức và đang đối chiếu toàn văn.",
    sources,
  };
}
