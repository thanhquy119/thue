import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import {
  TRANSFER_ALLOWED_CONTENT_TYPES,
  TRANSFER_MAX_FILE_BYTES,
  safeTransferFilename,
  transferFileId,
  transferMailboxId,
  transferSourcePath,
  validTransferKey,
} from "@/lib/transfer/core";
import { processTransferredBlob } from "@/lib/transfer/store";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type ClientPayload = {
  key?: unknown;
  mailboxId?: unknown;
  fileId?: unknown;
  name?: unknown;
  size?: unknown;
  contentType?: unknown;
};

function parseClientPayload(value: string | null | undefined) {
  const parsed = value ? JSON.parse(value) as ClientPayload : {};
  const key = typeof parsed.key === "string" ? parsed.key : "";
  const mailboxId = typeof parsed.mailboxId === "string" ? parsed.mailboxId : "";
  const fileId = transferFileId(typeof parsed.fileId === "string" ? parsed.fileId : "");
  const name = safeTransferFilename(typeof parsed.name === "string" ? parsed.name : "tai-lieu");
  const size = typeof parsed.size === "number" && Number.isFinite(parsed.size) ? parsed.size : 0;
  const contentType = typeof parsed.contentType === "string" ? parsed.contentType : "application/octet-stream";
  if (!validTransferKey(key) || transferMailboxId(key) !== mailboxId) throw new Error("Mã kết nối không hợp lệ.");
  if (size <= 0 || size > TRANSFER_MAX_FILE_BYTES) throw new Error("File phải nhỏ hơn 50 MB.");
  return { key, mailboxId, fileId, name, size, contentType };
}

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const parsed = parseClientPayload(clientPayload);
        const expectedPathname = transferSourcePath(parsed.mailboxId, parsed.fileId, parsed.name);
        if (pathname !== expectedPathname) throw new Error("Đường dẫn upload không hợp lệ.");
        return {
          allowedContentTypes: [...TRANSFER_ALLOWED_CONTENT_TYPES],
          maximumSizeInBytes: TRANSFER_MAX_FILE_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify(parsed),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const parsed = parseClientPayload(tokenPayload);
        await processTransferredBlob({
          mailboxId: parsed.mailboxId,
          fileId: parsed.fileId,
          name: parsed.name,
          size: parsed.size,
          contentType: parsed.contentType,
          sourcePathname: blob.pathname,
        });
      },
    });
    return NextResponse.json(response, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể tạo phiên tải file." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}
