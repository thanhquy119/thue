import { createHash } from "node:crypto";
import { isAllowedLegalSource } from "./ingestion";
import type { OnlineLegalSource } from "./types";

export type OfficialSourceDiscovery = {
  draft_answer: string;
  sources: OnlineLegalSource[];
};

const SEARCH_DOMAINS = [
  "vanban.chinhphu.vn",
  "congbao.chinhphu.vn",
  "vbpl.vn",
  "vbpq.mof.gov.vn",
  "mof.gov.vn",
  "gdt.gov.vn",
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

function parseBingRss(xml: string): OnlineLegalSource[] {
  const sources: OnlineLegalSource[] = [];
  const matches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  for (const [index, match] of matches.entries()) {
    const item = match[1];
    const title = decodeXml(textBetween(item, "title"));
    const url = decodeXml(textBetween(item, "link"));
    const snippet = decodeXml(textBetween(item, "description"));
    if (!url || !isAllowedLegalSource(url)) continue;
    sources.push({
      id: `rss-${createHash("sha256").update(url).digest("hex").slice(0, 20)}`,
      title: title || sourceLabel(url),
      url,
      snippet: snippet || "Nguồn pháp luật chính thức được tìm thấy.",
      score: Math.max(0.45, 0.88 - index * 0.035),
      source_label: sourceLabel(url),
      previewable: true,
    });
  }
  return sources;
}

async function searchBingRss(query: string): Promise<OnlineLegalSource[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const url = new URL("https://www.bing.com/search");
    url.searchParams.set("format", "rss");
    url.searchParams.set("count", "20");
    url.searchParams.set("q", query);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
        "user-agent": "Mozilla/5.0 (compatible; ThueRo/2.1; +https://thue-ro.vercel.app)",
      },
      next: { revalidate: 60 * 60 },
    });
    if (!response.ok) return [];
    return parseBingRss(await response.text());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverOfficialSources(query: string): Promise<OfficialSourceDiscovery> {
  const broadDomains = SEARCH_DOMAINS.map((domain) => `site:${domain}`).join(" OR ");
  const searches = [
    `${query} (${broadDomains})`,
    `"${query}" site:vanban.chinhphu.vn OR site:congbao.chinhphu.vn`,
    `${query} site:vbpq.mof.gov.vn OR site:gdt.gov.vn OR site:vbpl.vn`,
  ];
  const batches = await Promise.all(searches.map(searchBingRss));
  const sources = batches
    .flat()
    .filter((source, index, all) => all.findIndex((candidate) => candidate.url === source.url) === index)
    .slice(0, 18);

  if (!sources.length) {
    throw new Error("Chưa tìm thấy nguồn pháp luật chính thức có thể mở. Hãy nhập đầy đủ số hiệu và năm của văn bản.");
  }

  return {
    draft_answer: "Đã tìm thấy nguồn pháp luật chính thức và đang đối chiếu toàn văn.",
    sources,
  };
}
