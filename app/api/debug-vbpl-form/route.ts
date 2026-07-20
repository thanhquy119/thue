import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function probe(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 Chrome/131 Safari/537.36", "accept-language": "vi-VN,vi;q=0.9" },
    });
    const html = await response.text();
    return { url, status: response.status, length: html.length, sample: html.slice(0, 300) };
  } catch (error) {
    return { url, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const results = await Promise.all([
    probe("https://vbpl.vn/TW/Pages/vbpq-timkiem.aspx"),
    probe("https://vbpl.moj.gov.vn/TW/Pages/vbpq-timkiem.aspx"),
  ]);
  return NextResponse.json({ results });
}
