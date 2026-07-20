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
        hasDocument: Boolean(result.document),
        number: result.document?.number ?? null,
        title: result.document?.title ?? null,
        extractionMethod: result.document?.extraction_method ?? null,
        textLength: result.document?.official_text.length ?? 0,
        provisionCount: result.document?.provisions.length ?? 0,
        firstText: result.document?.official_text.slice(0, 800) ?? "",
        warnings: result.warnings,
        directAnswer: result.direct_answer,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
