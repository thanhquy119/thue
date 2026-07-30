import { NextResponse } from "next/server";
import { validTransferKey } from "@/lib/transfer/core";
import { reprocessTransferredPdf } from "@/lib/transfer/store";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "cache-control": "no-store", "x-robots-tag": "noindex" };

export async function POST(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  const key = request.headers.get("x-transfer-key") ?? "";
  if (!validTransferKey(key)) {
    return NextResponse.json({ error: "Mã kết nối không hợp lệ." }, { status: 401 });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Yêu cầu khác nguồn đã bị chặn." }, { status: 403 });
  }
  const { fileId } = await context.params;
  if (!/^[a-z0-9-]{12,80}$/iu.test(fileId)) {
    return NextResponse.json({ error: "Mã file không hợp lệ." }, { status: 400 });
  }

  try {
    const result = await reprocessTransferredPdf(key, fileId);
    if (!result) return NextResponse.json({ error: "Không tìm thấy file." }, { status: 404, headers: NO_STORE_HEADERS });
    const status = result.meta.status === "ready"
      ? 200
      : result.meta.status === "processing" || result.meta.status === "ocr_partial"
        ? 202
        : 422;
    console.info("[transfer-ocr-result]", JSON.stringify({
      fileId,
      status: result.meta.status,
      processedPages: result.meta.processedPages,
      totalPages: result.meta.totalPages,
      nextOcrAttemptAt: result.meta.nextOcrAttemptAt ?? null,
      error: result.meta.error ?? null,
    }));
    return NextResponse.json(result, { status, headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể tiếp tục OCR PDF.";
    console.error("[transfer-ocr-route]", JSON.stringify({ fileId, message }));
    const missingLegacyObject = /Vercel Blob.*403|Failed to fetch blob: 403|store has been suspended/iu.test(message);
    return NextResponse.json(
      { error: missingLegacyObject ? "File cũ không còn trong kho. Vui lòng dùng file vừa tải lại." : message },
      { status: missingLegacyObject ? 404 : 503, headers: NO_STORE_HEADERS },
    );
  }
}
