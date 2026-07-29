import { NextResponse } from "next/server";
import { validTransferKey } from "@/lib/transfer/core";
import { readTransferredFile } from "@/lib/transfer/store";
import { get } from "@/lib/storage/r2-blob-compat";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function dispositionFilename(filename: string) {
  const ascii = filename
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]+/gu, "_")
    .replace(/["\\]/gu, "_")
    .slice(0, 140) || "tai-lieu";
  const encoded = encodeURIComponent(filename).replace(/['()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

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
  const source = await get(file.meta.sourcePathname, { access: "private", useCache: false });
  if (!source || source.statusCode !== 200 || !source.stream) {
    return NextResponse.json({ error: "Không đọc được file gốc." }, { status: 404 });
  }
  return new Response(source.stream, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": dispositionFilename(file.meta.name),
      "content-length": String(file.meta.size),
      "content-type": file.meta.contentType || source.blob.contentType || "application/octet-stream",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex",
    },
  });
}
