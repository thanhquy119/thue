import { NextRequest, NextResponse } from "next/server";
import { discoverOfficialSources } from "@/lib/legal/discovery";
import { extractSearchHint, lexicalRelevance, normalizeLegalQuery } from "@/lib/legal/query";
import type { OnlineLegalSource } from "@/lib/legal/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function yearScore(date: string | null | undefined) {
  const year = Number(date?.slice(0, 4));
  if (!year) return 0;
  const currentYear = new Date().getFullYear();
  if (year === currentYear) return 3.2;
  if (year === currentYear - 1) return 1.7;
  if (year === currentYear - 2) return 0.7;
  if (year <= currentYear - 5) return -0.55;
  return 0;
}

function amendmentScore(value: string) {
  const normalized = normalizeLegalQuery(value);
  if (/\b(?:sua doi bo sung|thay the|bai bo)\b/.test(normalized)) return 2.2;
  if (/\b(?:quy dinh chi tiet|huong dan thi hanh)\b/.test(normalized)) return 0.35;
  return 0;
}

function score(query: string, source: OnlineLegalSource) {
  const hint = extractSearchHint(query);
  const haystack = normalizeLegalQuery(`${source.document_number ?? ""} ${source.document_type ?? ""} ${source.title} ${source.snippet}`);
  return source.score + lexicalRelevance(query, haystack) + (hint.asksQuestion ? yearScore(source.issued_date) + amendmentScore(`${source.title} ${source.snippet}`) : 0);
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() || "Hộ kinh doanh doanh thu 300 triệu đồng một năm có phải nộp thuế không?";
  const discovery = await discoverOfficialSources(query);
  const rows = discovery.sources
    .map((source) => ({
      number: source.document_number,
      date: source.issued_date,
      title: source.title,
      score: score(query, source),
      base: source.score,
      url: source.url,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  return NextResponse.json({ query, count: discovery.sources.length, rows }, { headers: { "cache-control": "no-store" } });
}
