import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_URL = "https://congbao.chinhphu.vn/van-ban-dang-cong-bao.htm?ky-hieu=100%2F2024%2FN%C4%90-CP";

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export async function GET() {
  const response = await fetch(PAGE_URL, {
    cache: "no-store",
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
    },
  });
  const text = await response.text();
  const links = [...text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)]
    .map((match) => {
      const href = decodeHtml(match[1]);
      const label = stripTags(match[2]);
      return { href, label };
    })
    .filter(({ href, label }) => /100(?:-|\/|%2f)2024|42431|\.docx?(?:$|\?)/iu.test(`${href} ${label}`));

  const scriptSources = [...text.matchAll(/<script\b[^>]*src=["']([^"']+)["']/giu)].map((match) => decodeHtml(match[1]));

  return NextResponse.json(
    {
      status: response.status,
      resolvedUrl: response.url,
      length: text.length,
      hasExactNumber: text.includes("100/2024/NĐ-CP"),
      hasDetailId: text.includes("42431"),
      links: links.slice(0, 100),
      scriptSources,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
