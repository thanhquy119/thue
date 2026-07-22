import { NextResponse } from "next/server";
import { ocrLabEnabled } from "@/lib/legal/ocr-experiment";

export const runtime = "nodejs";
export const maxDuration = 120;

const SAMPLE_URL = "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/4/11-bkhcn.pdf";

export async function GET() {
  if (!ocrLabEnabled()) return NextResponse.json({ error: "OCR Lab chưa được bật." }, { status: 404 });

  try {
    const response = await fetch(SAMPLE_URL);
    if (!response.ok) throw new Error(`Nguồn trả lỗi ${response.status}.`);
    const source = Buffer.from(await response.arrayBuffer());
    if (source.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Nguồn không trả về PDF.");

    const [{ PDFParse }, { CanvasFactory }] = await Promise.all([
      import("pdf-parse"),
      import("pdf-parse/worker"),
    ]);
    const parser = new PDFParse({ data: Uint8Array.from(source), CanvasFactory });
    try {
      const text = await parser.getText({ first: 1 });
      const info = await parser.getInfo();
      const screenshot = await parser.getScreenshot({
        first: 1,
        desiredWidth: 900,
        imageDataUrl: false,
        imageBuffer: true,
      });
      const image = screenshot.pages[0]?.data;
      return NextResponse.json({
        ok: Boolean(image),
        totalPages: info.total,
        textCharacters: text.text.length,
        imageBytes: image?.byteLength ?? 0,
        imageSignature: image ? Buffer.from(image).subarray(1, 4).toString("ascii") : "",
      }, { headers: { "cache-control": "no-store" } });
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  } catch (error) {
    console.error("PDF render smoke test error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Không render được PDF." }, { status: 400 });
  }
}
