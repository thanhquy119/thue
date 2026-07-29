import { NextResponse } from "next/server";
import { validTransferKey } from "@/lib/transfer/core";
import { reprocessTransferredPdf } from "@/lib/transfer/store";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

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

  const result = await reprocessTransferredPdf(key, fileId);
  if (!result) return NextResponse.json({ error: "Không tìm thấy file." }, { status: 404 });
  const status = result.meta.status === "ready" ? 200 : result.meta.status === "processing" ? 202 : 422;
  return NextResponse.json(result, {
    status,
    headers: { "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}
