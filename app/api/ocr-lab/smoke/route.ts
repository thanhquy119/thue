import { NextResponse } from "next/server";
import { installOcrFetchShim } from "@/lib/legal/ocr-fetch-shim";
import { runOcrBatch } from "@/lib/legal/ocr-batch-runner";
import { ocrLabEnabled } from "@/lib/legal/ocr-experiment";
import { OCR_SAMPLES } from "@/lib/legal/ocr-samples";

export const runtime = "nodejs";
export const maxDuration = 300;

installOcrFetchShim();

export async function GET(request: Request) {
  if (!ocrLabEnabled()) return NextResponse.json({ error: "OCR Lab chưa được bật." }, { status: 404 });
  const searchParams = new URL(request.url).searchParams;
  const index = Math.max(0, Math.min(OCR_SAMPLES.length - 1, Number(searchParams.get("sample") ?? 0)));
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const sample = OCR_SAMPLES[index];
  try {
    const result = await runOcrBatch(sample.url, { pages: [page] });
    return NextResponse.json({
      sample: sample.label,
      page,
      totalPages: result.totalPages,
      chosenPass: result.ocr.pages[0]?.chosenPass,
      score: result.ocr.pages[0]?.chosenScore,
      characters: result.ocr.pages[0]?.text.length,
      notices: result.ocr.pages[0]?.notices,
      warnings: result.warnings,
      preview: result.ocr.pages[0]?.text.slice(0, 500),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Smoke test failed." }, { status: 400 });
  }
}
