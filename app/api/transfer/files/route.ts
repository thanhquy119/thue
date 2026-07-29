import { NextResponse } from "next/server";
import { validTransferKey } from "@/lib/transfer/core";
import { deleteTransferredFile, listTransferredFiles } from "@/lib/transfer/store";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function keyFrom(request: Request) {
  return request.headers.get("x-transfer-key") ?? "";
}

export async function GET(request: Request) {
  const key = keyFrom(request);
  if (!validTransferKey(key)) return NextResponse.json({ error: "Mã kết nối không hợp lệ." }, { status: 401 });
  const files = await listTransferredFiles(key);
  return NextResponse.json({ files }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(request: Request) {
  const key = keyFrom(request);
  if (!validTransferKey(key)) return NextResponse.json({ error: "Mã kết nối không hợp lệ." }, { status: 401 });
  const fileId = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[a-z0-9-]{12,80}$/iu.test(fileId)) return NextResponse.json({ error: "Mã file không hợp lệ." }, { status: 400 });
  const result = await deleteTransferredFile(key, fileId);
  return NextResponse.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
}
