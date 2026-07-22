import { NextResponse } from "next/server";
import { installOcrFetchShim } from "@/lib/legal/ocr-fetch-shim";
import { isAllowedLegalSource } from "@/lib/legal/ingestion";
import { ocrLabEnabled } from "@/lib/legal/ocr-experiment";

export const runtime = "nodejs";
export const maxDuration = 60;

installOcrFetchShim();

export async function GET(request: Request) {
  if (!ocrLabEnabled()) return NextResponse.json({ error: "OCR Lab chưa được bật." }, { status: 404 });

  const url = new URL(request.url).searchParams.get("url")?.trim() || "";
  if (!url || !isAllowedLegalSource(url)) {
    return NextResponse.json({ error: "URL nguồn chính thức không hợp lệ." }, { status: 400 });
  }

  try {
    const response = await fetch(url, { redirect: "manual" });
    const buffer = Buffer.from(await response.arrayBuffer());
    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      resolvedUrl: response.url || url,
      contentType: response.headers.get("content-type"),
      bytes: buffer.byteLength,
      signature: buffer.subarray(0, 8).toString("ascii"),
      isPdf: buffer.subarray(0, 5).toString("ascii") === "%PDF-",
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("OCR PDF probe error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không tải được tệp thử nghiệm." },
      { status: 400 },
    );
  }
}
