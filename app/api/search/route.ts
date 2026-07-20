import { NextResponse } from "next/server";
import { cleanUserQuery, containsPromptInjection } from "@/lib/legal/query";
import { searchTaxLaw } from "@/lib/legal/search";
import { consumeMemoryRateLimit, requestFingerprint } from "@/lib/legal/security";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limit = consumeMemoryRateLimit(requestFingerprint(request));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Em thao tác hơi nhanh. Vui lòng thử lại sau ${limit.retryAfter} giây.` },
      { status: 429, headers: { "retry-after": String(limit.retryAfter), "cache-control": "no-store" } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { query?: unknown };
  const query = cleanUserQuery(body.query);
  if (query.length < 2 || query.length > 500) {
    return NextResponse.json(
      { error: "Câu hỏi phải có từ 2 đến 500 ký tự." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  if (containsPromptInjection(query)) {
    return NextResponse.json(
      { error: "Câu hỏi chứa chỉ dẫn không phù hợp với chức năng tra cứu pháp luật." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const result = await searchTaxLaw(query);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể tra cứu lúc này." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
