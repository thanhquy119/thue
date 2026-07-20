import { NextResponse } from "next/server";
import { searchTaxLaw } from "@/lib/legal/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const result = await searchTaxLaw("Nghị định 100/2024/NĐ-CP");
    return NextResponse.json(
      {
        ok: Boolean(result.document),
        directAnswer: result.direct_answer,
        document: result.document
          ? {
              number: result.document.number,
              title: result.document.title,
              sourceUrl: result.document.source_url,
              extractionMethod: result.document.extraction_method,
              qualityScore: result.document.quality_score,
              officialTextLength: result.document.official_text.length,
              provisionCount: result.document.provisions.length,
              firstText: result.document.official_text.slice(0, 500),
            }
          : null,
        warnings: result.warnings,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
