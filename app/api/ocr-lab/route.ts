import { NextResponse } from "next/server";
import { installOcrFetchShim } from "@/lib/legal/ocr-fetch-shim";
import { runAdaptiveOcrBatch } from "@/lib/legal/ocr-adaptive-runner";
import { ocrLabEnabled } from "@/lib/legal/ocr-experiment";
import { normalizeOcrModelChoice } from "@/lib/legal/ocr-models";

export const runtime = "nodejs";
export const maxDuration = 300;

installOcrFetchShim();

export async function POST(request: Request) {
  if (!ocrLabEnabled()) {
    return NextResponse.json({ error: "OCR Lab chưa được bật trên môi trường này." }, { status: 404 });
  }

  try {
    const body = (await request.json()) as {
      url?: unknown;
      maxPages?: unknown;
      pages?: unknown;
      model?: unknown;
    };
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const requestedMaxPages = typeof body.maxPages === "number" ? body.maxPages : Number(body.maxPages ?? 3);
    const maxPages = Number.isFinite(requestedMaxPages)
      ? Math.max(1, Math.min(6, Math.floor(requestedMaxPages)))
      : 3;
    const requestedPages = Array.isArray(body.pages)
      ? body.pages.map((page) => Number(page)).filter(Number.isFinite)
      : [];
    const pages = requestedPages.length
      ? requestedPages
      : Array.from({ length: maxPages }, (_, index) => index + 1);
    const model = normalizeOcrModelChoice(body.model);

    if (!url) return NextResponse.json({ error: "Vui lòng nhập liên kết PDF chính thức." }, { status: 400 });
    const result = await runAdaptiveOcrBatch(url, { pages, model });
    return NextResponse.json(result, {
      headers: {
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể chạy OCR thử nghiệm.";
    console.error("OCR Lab error", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
