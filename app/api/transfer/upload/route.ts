import { after, NextResponse } from "next/server";
import {
  TRANSFER_ALLOWED_CONTENT_TYPES,
  TRANSFER_MAX_FILE_BYTES,
  TRANSFER_MAX_UPLOAD_CHUNKS,
  TRANSFER_UPLOAD_CHUNK_BYTES,
  safeTransferFilename,
  transferFileId,
  transferMailboxId,
  transferSourcePath,
  transferUploadChunkPath,
  transferUploadChunkPrefix,
  transferUploadSessionPath,
  validTransferKey,
  type TransferFileRecord,
  type TransferUploadSession,
} from "@/lib/transfer/core";
import { processTransferredBlob, readTransferredFile } from "@/lib/transfer/store";
import {
  del,
  get,
  list,
  put,
  storageBackend,
  storageConfigured,
} from "@/lib/storage/r2-blob-compat";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "cache-control": "no-store", "x-robots-tag": "noindex" };

type UploadRequest = {
  action?: unknown;
  key?: unknown;
  fileId?: unknown;
  name?: unknown;
  size?: unknown;
  contentType?: unknown;
  totalChunks?: unknown;
};

function uploadErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /R2|Vercel Blob|Kho file|Failed to fetch|fetch failed/iu.test(message) ? 503 : 400;
}

function errorResponse(error: unknown, status = uploadErrorStatus(error)) {
  console.error("[transfer-upload]", error);
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Không thể tải file." },
    { status, headers: NO_STORE_HEADERS },
  );
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new Error("Yêu cầu tải file khác nguồn đã bị chặn.");
}

function explicitFileId(value: unknown) {
  const raw = typeof value === "string" ? value : "";
  const normalized = transferFileId(raw);
  if (normalized !== raw || !/^[a-z0-9-]{12,80}$/iu.test(raw)) throw new Error("Mã file không hợp lệ.");
  return normalized;
}

function parseUploadRequest(value: UploadRequest) {
  const key = typeof value.key === "string" ? value.key : "";
  if (!validTransferKey(key)) throw new Error("Mã kết nối không hợp lệ.");
  const mailboxId = transferMailboxId(key);
  const fileId = explicitFileId(value.fileId);
  const name = safeTransferFilename(typeof value.name === "string" ? value.name : "tai-lieu");
  const size = typeof value.size === "number" && Number.isFinite(value.size) ? Math.floor(value.size) : 0;
  const contentType = typeof value.contentType === "string" && value.contentType.trim()
    ? value.contentType.split(";")[0].trim().toLocaleLowerCase("en")
    : "application/octet-stream";
  const totalChunks = typeof value.totalChunks === "number" && Number.isFinite(value.totalChunks)
    ? Math.floor(value.totalChunks)
    : 0;
  if (size <= 0 || size > TRANSFER_MAX_FILE_BYTES) throw new Error("File phải nhỏ hơn 50 MB.");
  const expectedChunks = Math.ceil(size / TRANSFER_UPLOAD_CHUNK_BYTES);
  if (totalChunks !== expectedChunks || totalChunks < 1 || totalChunks > TRANSFER_MAX_UPLOAD_CHUNKS) {
    throw new Error("Số phần tải lên không hợp lệ.");
  }
  if (!TRANSFER_ALLOWED_CONTENT_TYPES.includes(contentType as (typeof TRANSFER_ALLOWED_CONTENT_TYPES)[number])) {
    throw new Error("Định dạng file chưa được hỗ trợ.");
  }
  return { key, mailboxId, fileId, name, size, contentType, totalChunks };
}

async function readSession(mailboxId: string, fileId: string) {
  let stored: Awaited<ReturnType<typeof get>> = null;
  try {
    stored = await get(transferUploadSessionPath(mailboxId, fileId), { access: "private", useCache: false });
  } catch (error) {
    // R2 is the source of truth for transfers. A suspended legacy Blob store must
    // never turn an ordinary R2 cache miss into a failed upload.
    if (error instanceof Error && /Vercel Blob.*403|store has been suspended/iu.test(error.message)) return null;
    throw error;
  }
  if (!stored || stored.statusCode !== 200 || !stored.stream) return null;
  const text = await new Response(stored.stream).text();
  return text ? JSON.parse(text) as TransferUploadSession : null;
}

function needsBackgroundOcr(record: TransferFileRecord) {
  const isPdf = record.contentType.includes("pdf") || record.name.toLocaleLowerCase("en").endsWith(".pdf");
  return isPdf && record.status !== "ready" && (
    record.status === "processing" ||
    record.status === "ocr_partial" ||
    (record.extractionMethod === "pdf_ocr" && record.processedPages < record.totalPages)
  );
}

function scheduleBackgroundOcr(requestUrl: string, key: string, record: TransferFileRecord) {
  if (!needsBackgroundOcr(record)) return;
  after(async () => {
    const endpoint = new URL(`/api/transfer/files/${encodeURIComponent(record.id)}/process`, requestUrl);
    endpoint.searchParams.set("background", "1");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "x-transfer-key": key },
        cache: "no-store",
      });
      if (!response.ok && response.status !== 202) {
        console.error("[transfer-ocr-start]", JSON.stringify({ fileId: record.id, status: response.status }));
      }
    } catch (error) {
      console.error("[transfer-ocr-start]", JSON.stringify({
        fileId: record.id,
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  });
}

async function initializeUpload(parsed: ReturnType<typeof parseUploadRequest>) {
  if (!storageConfigured()) throw new Error("Kho file riêng tư chưa được cấu hình.");
  const pathname = transferUploadSessionPath(parsed.mailboxId, parsed.fileId);
  const session: TransferUploadSession = {
    mailboxId: parsed.mailboxId,
    fileId: parsed.fileId,
    name: parsed.name,
    size: parsed.size,
    contentType: parsed.contentType,
    totalChunks: parsed.totalChunks,
    createdAt: new Date().toISOString(),
  };

  // fileId is a fresh UUID generated by the client. Writing the R2 session
  // directly avoids probing the suspended legacy Blob store when the object
  // correctly does not exist yet. Overwrite keeps a retried init idempotent.
  await put(pathname, JSON.stringify(session), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    cacheControlMaxAge: 300,
    contentType: "application/json; charset=utf-8",
  });

  return NextResponse.json({
    ok: true,
    file_id: parsed.fileId,
    chunk_bytes: TRANSFER_UPLOAD_CHUNK_BYTES,
    total_chunks: parsed.totalChunks,
    backend: storageBackend(),
  }, { headers: NO_STORE_HEADERS });
}

async function completeUpload(parsed: ReturnType<typeof parseUploadRequest>, requestUrl: string) {
  const existing = await readTransferredFile(parsed.key, parsed.fileId).catch(() => null);
  if (existing?.meta) {
    scheduleBackgroundOcr(requestUrl, parsed.key, existing.meta);
    return NextResponse.json({ ok: true, file: existing.meta, backend: storageBackend() }, { headers: NO_STORE_HEADERS });
  }
  const session = await readSession(parsed.mailboxId, parsed.fileId);
  if (!session) throw new Error("Phiên tải file không còn tồn tại. Vui lòng chọn file và gửi lại.");
  if (
    session.name !== parsed.name ||
    session.size !== parsed.size ||
    session.contentType !== parsed.contentType ||
    session.totalChunks !== parsed.totalChunks
  ) throw new Error("Thông tin hoàn tất không khớp phiên tải file.");

  const chunkPrefix = transferUploadChunkPrefix(parsed.mailboxId, parsed.fileId);
  const listed = await list({ prefix: chunkPrefix, limit: TRANSFER_MAX_UPLOAD_CHUNKS + 1 });
  const chunks = listed.blobs
    .filter((blob) => blob.pathname.endsWith(".bin"))
    .sort((left, right) => left.pathname.localeCompare(right.pathname));
  if (chunks.length !== parsed.totalChunks) {
    throw new Error(`File mới nhận đủ ${chunks.length}/${parsed.totalChunks} phần.`);
  }

  const buffers: Buffer[] = [];
  let totalBytes = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const expectedPath = transferUploadChunkPath(parsed.mailboxId, parsed.fileId, index);
    if (chunks[index].pathname !== expectedPath) throw new Error("Thứ tự phần file không liên tục.");
    const stored = await get(expectedPath, { access: "private", useCache: false });
    if (!stored || stored.statusCode !== 200 || !stored.stream) throw new Error(`Không đọc được phần ${index + 1}.`);
    const buffer = Buffer.from(await new Response(stored.stream).arrayBuffer());
    const expectedBytes = index === parsed.totalChunks - 1
      ? parsed.size - TRANSFER_UPLOAD_CHUNK_BYTES * (parsed.totalChunks - 1)
      : TRANSFER_UPLOAD_CHUNK_BYTES;
    if (buffer.byteLength !== expectedBytes) throw new Error(`Kích thước phần ${index + 1} không khớp.`);
    buffers.push(buffer);
    totalBytes += buffer.byteLength;
  }
  if (totalBytes !== parsed.size) throw new Error("Dung lượng file hoàn chỉnh không khớp.");

  const sourceBuffer = Buffer.concat(buffers, totalBytes);
  const sourcePathname = transferSourcePath(parsed.mailboxId, parsed.fileId, parsed.name);
  await put(sourcePathname, sourceBuffer, {
    access: "private",
    allowOverwrite: false,
    addRandomSuffix: false,
    cacheControlMaxAge: 31_536_000,
    contentType: parsed.contentType,
  });

  try {
    const record = await processTransferredBlob({
      mailboxId: parsed.mailboxId,
      fileId: parsed.fileId,
      name: parsed.name,
      size: parsed.size,
      contentType: parsed.contentType,
      sourcePathname,
      sourceBuffer,
    });
    scheduleBackgroundOcr(requestUrl, parsed.key, record);
    return NextResponse.json({ ok: true, file: record, backend: storageBackend() }, { headers: NO_STORE_HEADERS });
  } finally {
    await del([
      ...chunks.map((chunk) => chunk.pathname),
      transferUploadSessionPath(parsed.mailboxId, parsed.fileId),
    ]).catch(() => undefined);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await request.json() as UploadRequest;
    const parsed = parseUploadRequest(body);
    if (body.action === "init") return initializeUpload(parsed);
    if (body.action === "complete") return completeUpload(parsed, request.url);
    throw new Error("Thao tác tải file không hợp lệ.");
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    if (!storageConfigured()) throw new Error("Kho file riêng tư chưa được cấu hình.");
    const key = request.headers.get("x-transfer-key") ?? "";
    if (!validTransferKey(key)) throw new Error("Mã kết nối không hợp lệ.");
    const mailboxId = transferMailboxId(key);
    const url = new URL(request.url);
    const fileId = explicitFileId(url.searchParams.get("file_id"));
    const index = Number(url.searchParams.get("index"));
    if (!Number.isInteger(index) || index < 0 || index >= TRANSFER_MAX_UPLOAD_CHUNKS) {
      throw new Error("Thứ tự phần tải lên không hợp lệ.");
    }
    const session = await readSession(mailboxId, fileId);
    if (!session) throw new Error("Phiên tải file không tồn tại.");
    if (index >= session.totalChunks) throw new Error("Phần tải lên vượt quá số phần dự kiến.");
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > TRANSFER_UPLOAD_CHUNK_BYTES) throw new Error("Phần tải lên vượt giới hạn.");
    const body = Buffer.from(await request.arrayBuffer());
    const expectedBytes = index === session.totalChunks - 1
      ? session.size - TRANSFER_UPLOAD_CHUNK_BYTES * (session.totalChunks - 1)
      : TRANSFER_UPLOAD_CHUNK_BYTES;
    if (body.byteLength !== expectedBytes) throw new Error("Kích thước phần tải lên không khớp.");
    const pathname = transferUploadChunkPath(mailboxId, fileId, index);
    await put(pathname, body, {
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      cacheControlMaxAge: 300,
      contentType: "application/octet-stream",
    });
    return NextResponse.json({ ok: true, index, bytes: body.byteLength, backend: storageBackend() }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}
