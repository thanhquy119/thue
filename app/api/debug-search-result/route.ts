import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() || "Thông tư 89 Bộ Tài chính";
  const response = await fetch(new URL("/api/search", request.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  const payload = await response.json();
  return NextResponse.json({
    status: response.status,
    answer: payload.direct_answer ?? payload.error ?? null,
    document: payload.document?.number ?? null,
    candidates: (payload.candidates ?? []).map((item: { number?: string; issuer?: string }) => ({ number: item.number, issuer: item.issuer })),
  }, { status: response.status, headers: { "cache-control": "no-store" } });
}
