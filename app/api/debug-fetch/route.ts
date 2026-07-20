import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SEARCH_URL = "https://congbao.chinhphu.vn/van-ban-dang-cong-bao.htm?ky-hieu=100%2F2024%2FN%C4%90-CP";

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLocaleLowerCase("en")] ?? `&${entity};`;
  });
}

function stripTags(value: string) {
  return decodeHtml(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(value: string, base: string) {
  try {
    return new URL(decodeHtml(value), base).toString();
  } catch {
    return "";
  }
}

export async function GET() {
  const headers = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
    "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
  };
  const search = await fetch(SEARCH_URL, { cache: "no-store", headers });
  const searchHtml = await search.text();
  const links = [...searchHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)]
    .map((match) => ({
      url: absoluteUrl(match[1], SEARCH_URL),
      title: stripTags(match[2]),
      context: stripTags(
        searchHtml.slice(
          Math.max(0, (match.index ?? 0) - 600),
          Math.min(searchHtml.length, (match.index ?? 0) + match[0].length + 900),
        ),
      ),
    }))
    .filter((item) => /\/van-ban\/[^/?#]+(?:\.htm|\/\d+\.htm)/iu.test(item.url))
    .filter((item, index, all) => item.url && all.findIndex((candidate) => candidate.url === item.url) === index)
    .slice(0, 40);

  const exact = links.find((item) =>
    /100\s*\/\s*2024\s*\/\s*N[ĐD]-CP/iu.test(`${item.title} ${item.context}`),
  ) ?? null;

  let detail: Record<string, unknown> | null = null;
  if (exact) {
    const page = await fetch(exact.url, { cache: "no-store", headers });
    const pageHtml = await page.text();
    const pageLinks = [...pageHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)]
      .map((match) => ({
        url: absoluteUrl(match[1], exact.url),
        label: stripTags(match[2]),
      }))
      .filter((item) =>
        /tai-ve-van-ban|\/van-ban\/[^/?#]+\/\d+\.htm|g7\.cdnchinhphu\.vn|\.(?:pdf|docx?)(?:\?|$)/iu.test(item.url),
      )
      .filter((item, index, all) => item.url && all.findIndex((candidate) => candidate.url === item.url) === index)
      .slice(0, 40);
    detail = {
      status: page.status,
      resolvedUrl: page.url,
      htmlLength: pageHtml.length,
      exactNumberFound: /100\s*\/\s*2024\s*\/\s*N[ĐD]-CP/iu.test(stripTags(pageHtml)),
      links: pageLinks,
    };
  }

  return NextResponse.json(
    {
      searchStatus: search.status,
      resolvedSearchUrl: search.url,
      searchHtmlLength: searchHtml.length,
      exactNumberFound: /100\s*\/\s*2024\s*\/\s*N[ĐD]-CP/iu.test(stripTags(searchHtml)),
      links,
      exact,
      detail,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
