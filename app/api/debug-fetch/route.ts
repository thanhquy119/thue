import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const API_URL = "https://api-searchcongbao.chinhphu.vn/search/van-ban";

export async function GET() {
  const response = await fetch(API_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: "https://congbao.chinhphu.vn",
      referer: "https://congbao.chinhphu.vn/",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
    },
    body: JSON.stringify({
      filters: {},
      page: 1,
      page_size: 10,
      query: "100/2024/NĐ-CP",
    }),
  });
  const text = await response.text();
  let payload: unknown = text;
  try { payload = JSON.parse(text); } catch {}
  return NextResponse.json(
    {
      status: response.status,
      contentType: response.headers.get("content-type"),
      payload,
    },
    { status: response.ok ? 200 : response.status, headers: { "cache-control": "no-store" } },
  );
}
