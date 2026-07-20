import { NextRequest, NextResponse } from "next/server";
import { searchTaxLaw } from "@/lib/legal/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() || "Thông tư 89";
  const result = await searchTaxLaw(query);
  return NextResponse.json(
    {
      query,
      kind: result.query_kind,
      answer: result.direct_answer,
      confidence: result.confidence,
      document: result.document
        ? {
            number: result.document.number,
            title: result.document.title,
            textLength: result.document.official_text.length,
            provisionCount: result.document.provisions.length,
          }
        : null,
      candidates: (result.candidates ?? []).map((candidate) => ({
        number: candidate.number,
        type: candidate.type,
        issuer: candidate.issuer,
        issuedDate: candidate.issued_date,
        title: candidate.title,
      })),
      warnings: result.warnings,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
