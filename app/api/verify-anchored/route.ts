import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const response = await fetch(new URL("/api/search", request.url), {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.89" },
    body: JSON.stringify({
      query: "Phân tích văn bản bổ sung dựa trên Thông tư 89/2026/BTC",
    }),
    cache: "no-store",
  });
  const payload = await response.json();
  return NextResponse.json(
    {
      status: response.status,
      query_kind: payload.query_kind,
      document_number: payload.document?.number ?? null,
      candidate_numbers: (payload.candidates ?? []).map((candidate: { number: string }) => candidate.number),
      answer_preview: typeof payload.direct_answer === "string" ? payload.direct_answer.slice(0, 500) : null,
      warnings: payload.warnings ?? [],
    },
    { status: response.ok ? 200 : response.status, headers: { "cache-control": "no-store" } },
  );
}
