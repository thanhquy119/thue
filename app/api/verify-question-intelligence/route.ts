import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CASES: Record<string, string> = {
  clarify: "Thuế suất bao nhiêu?",
  free: "Doanh nghiệp hoàn thuế GTGT thì cần hồ sơ gì và thời hạn xử lý bao lâu?",
  lookup: "Luật quản lý thuế số 108 năm 2025 của Quốc hội",
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const selected = url.searchParams.get("case") || "clarify";
  const query = CASES[selected];
  if (!query) return NextResponse.json({ error: "unknown case" }, { status: 400 });

  const response = await fetch(new URL("/api/search", request.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `127.0.1.${selected === "clarify" ? "1" : selected === "free" ? "2" : "3"}`,
    },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  const payload = await response.json();
  return NextResponse.json(
    {
      case: selected,
      status: response.status,
      query_kind: payload.query_kind,
      document_number: payload.document?.number ?? null,
      answer_preview: typeof payload.direct_answer === "string" ? payload.direct_answer.slice(0, 700) : null,
      warnings: payload.warnings ?? [],
    },
    { status: response.ok ? 200 : response.status, headers: { "cache-control": "no-store" } },
  );
}
