import { NextResponse } from "next/server";
import { installOcrFetchShim } from "@/lib/legal/ocr-fetch-shim";
import { ocrLabEnabled } from "@/lib/legal/ocr-experiment";

export const runtime = "nodejs";
export const maxDuration = 60;

installOcrFetchShim();

const SAMPLE_URL = "https://www.gdt.gov.vn/wps/wcm/connect/47f4914e-e997-409a-81d4-918b69e6f979/4937+CT+NVT.pdf?MOD=AJPERES&CACHEID=ROOTWORKSPACE47f4914e-e997-409a-81d4-918b69e6f979";

export async function GET() {
  if (!ocrLabEnabled()) return NextResponse.json({ error: "OCR Lab chưa được bật." }, { status: 404 });
  try {
    const response = await fetch(SAMPLE_URL, { redirect: "manual" });
    const buffer = Buffer.from(await response.arrayBuffer());
    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      resolvedUrl: response.url || SAMPLE_URL,
      contentType: response.headers.get("content-type"),
      bytes: buffer.byteLength,
      signature: buffer.subarray(0, 8).toString("ascii"),
      isPdf: buffer.subarray(0, 5).toString("ascii") === "%PDF-",
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("GDT PDF smoke test error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Không tải được tệp." }, { status: 400 });
  }
}
