import { NextResponse } from "next/server";
import { validTransferKey } from "@/lib/transfer/core";
import { readTransferredFile } from "@/lib/transfer/store";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  const key = request.headers.get("x-transfer-key") ?? "";
  if (!validTransferKey(key)) return NextResponse.json({ error: "Mã kết nối không hợp lệ." }, { status: 401 });
  const { fileId } = await context.params;
  if (!/^[a-z0-9-]{12,80}$/iu.test(fileId)) return NextResponse.json({ error: "Mã file không hợp lệ." }, { status: 400 });
  const file = await readTransferredFile(key, fileId);
  if (!file) return NextResponse.json({ error: "Không tìm thấy file." }, { status: 404 });
  return NextResponse.json(file, { headers: { "cache-control": "no-store" } });
}
