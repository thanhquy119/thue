import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_URL = "https://congbao.chinhphu.vn/van-ban-dang-cong-bao.htm";

function decodeHtml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function context(text: string, needle: string) {
  const index = text.toLocaleLowerCase("vi").indexOf(needle.toLocaleLowerCase("vi"));
  if (index < 0) return null;
  return text.slice(Math.max(0, index - 900), Math.min(text.length, index + needle.length + 2200));
}

export async function GET() {
  const response = await fetch(PAGE_URL, {
    cache: "no-store",
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
    },
  });
  const text = decodeHtml(await response.text());
  const urls = new Set<string>();

  for (const match of text.matchAll(/(?:src\s*=\s*|loadJs(?:Defer)?\s*\(\s*)["']([^"']+\.js(?:\?[^"']*)?)["']/giu)) {
    try {
      urls.add(new URL(match[1], PAGE_URL).toString());
    } catch {}
  }
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+\.js(?:\?[^\s"'<>]*)?/giu)) {
    urls.add(match[0]);
  }

  return NextResponse.json(
    {
      status: response.status,
      length: text.length,
      scripts: [...urls].slice(0, 100),
      loadJs: context(text, "loadJs("),
      loadJsDefer: context(text, "loadJsDefer("),
      mainBundle: context(text, "main-"),
      searchAction: context(text, 'data-atc="searchvanban"'),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
