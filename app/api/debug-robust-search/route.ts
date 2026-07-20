import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() || "luật quản lý thuế 108";
  const response = await fetch(new URL("/api/search", request.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  const payload = await response.json();
  return NextResponse.json(
    {
      status: response.status,
      query,
      kind: payload.query_kind ?? null,
      answer: payload.direct_answer ?? payload.error ?? null,
      document: payload.document
        ? {
            number: payload.document.number,
            title: payload.document.title,
            issuer: payload.document.issuer,
            status: payload.document.status,
            text_length: payload.document.official_text?.length ?? 0,
          }
        : null,
      candidates: (payload.candidates ?? []).slice(0, 5).map((item: { number?: string; title?: string }) => ({
        number: item.number,
        title: item.title,
      })),
    },
    { status: response.status, headers: { "cache-control": "no-store" } },
  );
}
