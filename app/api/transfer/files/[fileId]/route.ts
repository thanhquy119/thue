import { after, NextResponse } from "next/server";
import { validTransferKey } from "@/lib/transfer/core";
import { TRANSFER_EXTRACTION_VERSION } from "@/lib/transfer/extraction";
import {
  readTransferredFile,
  refreshTransferredFileExtraction,
} from "@/lib/transfer/store";

export const runtime = "nodejs";
export const maxDuration = 300;
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

  const legacyOfficeFile = ["doc", "docx", "html"].includes(file.meta.extractionMethod ?? "") &&
    file.meta.extractionVersion !== TRANSFER_EXTRACTION_VERSION;
  if (legacyOfficeFile) {
    after(async () => {
      await refreshTransferredFileExtraction(key, fileId).catch((error) => {
        console.error("[transfer-reextract]", error);
      });
    });
  }

  return NextResponse.json(file, { headers: { "cache-control": "no-store" } });
}
