import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JS_URL = "https://static.mediacdn.vn/CongBao/min/main-06042026v1.min.js";

function uniqueMatches(text: string, pattern: RegExp, limit = 300) {
  const values = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const value = match[1] ?? match[0];
    if (value) values.add(value);
    if (values.size >= limit) break;
  }
  return [...values];
}

function contexts(text: string, pattern: RegExp, limit = 30) {
  const values: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    values.push(text.slice(Math.max(0, index - 500), Math.min(text.length, index + match[0].length + 1200)));
    if (values.length >= limit) break;
  }
  return values;
}

export async function GET() {
  const response = await fetch(JS_URL, {
    cache: "no-store",
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      accept: "text/javascript,application/javascript,*/*;q=0.8",
    },
  });
  const text = await response.text();
  return NextResponse.json(
    {
      status: response.status,
      length: text.length,
      apiPaths: uniqueMatches(text, /["']([^"']*(?:\/api\/|ajax|search)[^"']*)["']/giu),
      legalStrings: uniqueMatches(text, /["']([^"']*(?:vanban|van-ban|congbao|keyword|kyhieu|ky-hieu)[^"']*)["']/giu),
      endpointContexts: contexts(text, /(?:\/api\/|ajaxDomain|searchvanban|getlistby|van-ban|keyword|kyhieu)/giu),
      tail: text.slice(-30000),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
