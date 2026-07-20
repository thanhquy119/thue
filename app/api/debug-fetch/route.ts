import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const URL_VALUE = "https://congbao.chinhphu.vn/van-ban-dang-cong-bao.htm";

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

export async function GET() {
  const response = await fetch(URL_VALUE, {
    cache: "no-store",
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
    },
  });
  const html = await response.text();
  const scriptOpenings = [...html.matchAll(/<script\b[^>]*>/giu)].map((match) => decodeHtml(match[0])).slice(0, 100);
  const patterns = ["searchvanban", "tim-kiem-van-ban", "data-atc", "ddlLoaiThongTin", "searchFormDate", "fetch(", "$.ajax", "/api/"];
  const contexts = patterns.map((pattern) => {
    const lower = html.toLocaleLowerCase("vi");
    const index = lower.indexOf(pattern.toLocaleLowerCase("vi"));
    return {
      pattern,
      index,
      context: index >= 0 ? decodeHtml(html.slice(Math.max(0, index - 3000), Math.min(html.length, index + 12000))) : "",
    };
  });
  const urlStrings = [...html.matchAll(/["']([^"']*(?:tim-kiem|search|api)[^"']*)["']/giu)]
    .map((match) => decodeHtml(match[1]))
    .filter((value, index, all) => value.length < 500 && all.indexOf(value) === index)
    .slice(0, 200);
  return NextResponse.json(
    { status: response.status, htmlLength: html.length, scriptOpenings, contexts, urlStrings },
    { headers: { "cache-control": "no-store" } },
  );
}
