import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function probe(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 Chrome/131 Safari/537.36", "accept-language": "vi-VN,vi;q=0.9" },
    });
    const text = await response.text();
    return { url, status: response.status, length: text.length, sample: text.slice(0, 1_500) };
  } catch (error) {
    return { url, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const results = await Promise.all([
    probe("https://r.jina.ai/http://vbpl.vn/TW/Pages/vbpq-thuoctinh.aspx?ItemID=136460"),
    probe("https://r.jina.ai/http://vbpl.vn/TW/Pages/vbpq-thuoctinh.aspx?ItemID=140487"),
  ]);
  return NextResponse.json({ results });
}
