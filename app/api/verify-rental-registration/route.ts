import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const response = await fetch(new URL("/api/search", request.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "127.0.2.86",
    },
    body: JSON.stringify({
      query: "Cho thuê nhà dưới 100 triệu thì có cần đăng ký thuế không?",
    }),
    cache: "no-store",
  });
  const payload = await response.json();
  return NextResponse.json(
    {
      status: response.status,
      answer: payload.direct_answer ?? null,
      document_number: payload.document?.number ?? null,
      candidates: (payload.candidates ?? []).map((candidate: { number?: string }) => candidate.number),
      warnings: payload.warnings ?? [],
      confidence: payload.confidence ?? null,
    },
    { status: response.ok ? 200 : response.status, headers: { "cache-control": "no-store" } },
  );
}
