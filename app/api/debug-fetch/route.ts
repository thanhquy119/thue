import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEARCH_URL = "https://congbao.chinhphu.vn/tim-kiem?keyword=100%2F2024%2FN%C4%90-CP";

function decodeHtml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export async function GET() {
  const response = await fetch(SEARCH_URL, {
    cache: "no-store",
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
    },
  });
  const html = await response.text();
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)]
    .map((match) => {
      let url = "";
      try {
        url = new URL(decodeHtml(match[1]), SEARCH_URL).toString();
      } catch {}
      return { url, title: stripTags(match[2]) };
    })
    .filter((item) => /\/van-ban\/|tai-ve-van-ban/iu.test(item.url) || /100\s*\/\s*2024\s*\/\s*N[ĐD]-CP/iu.test(item.title))
    .filter((item, index, all) => item.url && all.findIndex((candidate) => candidate.url === item.url) === index)
    .slice(0, 40);

  return NextResponse.json(
    {
      status: response.status,
      resolvedUrl: response.url,
      htmlLength: html.length,
      exactNumberFound: /100\s*\/\s*2024\s*\/\s*N[ĐD]-CP/iu.test(stripTags(html)),
      links,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
