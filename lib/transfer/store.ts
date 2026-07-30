import { randomUUID } from "node:crypto";
import { del, get, list, put } from "../storage/r2-blob-compat.ts";
import {
  transferBasePath,
  transferMailboxId,
  transferMetaPath,
  transferOcrCheckpointPath,
  transferOcrLeasePath,
  transferTextPath,
  type TransferFileRecord,
} from "./core";
import {
  extractTransferredFile,
  normalizeTransferredText,
  TRANSFER_EXTRACTION_VERSION,
} from "./extraction";
import {
  OCR_PAGES_PER_RUN,
  TransferOcrRateLimitError,
  ocrTransferredPdfBatch,
} from "./pdf-ocr.ts";

const OCR_CHECKPOINT_VERSION = 1;
const OCR_LEASE_MS = 240_000;
const OCR_LEASE_SETTLE_MS = 250;
const OCR_BUSY_RETRY_MS = 30_000;
const OCR_TRANSIENT_RETRY_MS = 65_000;

type TransferOcrCheckpoint = {
  version: number;
  totalPages: number;
  pages: Array<string | null>;
};

type TransferOcrLease = {
  token: string;
  fileId: string;
  expiresAt: string;
};

type TransferOcrLeaseAttempt = {
  lease: TransferOcrLease | null;
  busyUntil: string | null;
};

async function streamBuffer(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) throw new Error("Không đọc được file đã tải lên.");
  return Buffer.from(await new Response(stream).arrayBuffer());
}

async function readJson<T>(pathname: string): Promise<T | null> {
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  const text = await new Response(result.stream).text();
  return text ? JSON.parse(text) as T : null;
}

async function writeJson(pathname: string, value: unknown) {
  return put(pathname, JSON.stringify(value), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 60,
  });
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function leaseExpiry() {
  return new Date(Date.now() + OCR_LEASE_MS).toISOString();
}

function unexpired(value: string | null | undefined) {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

export function expireOcrLeaseRecord(lease: TransferOcrLease): TransferOcrLease {
  return { ...lease, expiresAt: new Date(0).toISOString() };
}

async function acquireOcrLease(mailboxId: string, fileId: string): Promise<TransferOcrLeaseAttempt> {
  const pathname = transferOcrLeasePath(mailboxId);
  const existing = await readJson<TransferOcrLease>(pathname).catch(() => null);
  if (existing && unexpired(existing.expiresAt)) {
    return { lease: null, busyUntil: existing.expiresAt };
  }

  const lease: TransferOcrLease = { token: randomUUID(), fileId, expiresAt: leaseExpiry() };
  await writeJson(pathname, lease);
  await wait(OCR_LEASE_SETTLE_MS);
  const confirmed = await readJson<TransferOcrLease>(pathname).catch(() => null);
  if (confirmed?.token === lease.token) return { lease, busyUntil: null };
  return {
    lease: null,
    busyUntil: confirmed && unexpired(confirmed.expiresAt) ? confirmed.expiresAt : null,
  };
}

async function refreshOcrLease(mailboxId: string, lease: TransferOcrLease) {
  const pathname = transferOcrLeasePath(mailboxId);
  const current = await readJson<TransferOcrLease>(pathname).catch(() => null);
  if (current?.token !== lease.token) throw new Error("Lượt OCR đã được chuyển sang tiến trình khác.");
  lease.expiresAt = leaseExpiry();
  await writeJson(pathname, lease);
}

async function releaseOcrLease(mailboxId: string, lease: TransferOcrLease | null) {
  if (!lease) return;
  const pathname = transferOcrLeasePath(mailboxId);
  const current = await readJson<TransferOcrLease>(pathname).catch(() => null);
  if (current?.token === lease.token) {
    // Không xóa object lease trên R2: lớp tương thích dùng tombstone cho object đã xóa,
    // khiến cùng pathname không thể được đọc lại sau lần đầu. Ghi một lease hết hạn để tái sử dụng.
    await writeJson(pathname, expireOcrLeaseRecord(lease)).catch(() => undefined);
  }
}

function contiguousPageCount(pages: Array<string | null>) {
  let count = 0;
  while (typeof pages[count] === "string" && pages[count]?.trim()) count += 1;
  return count;
}

function retryableOcrError(error: unknown) {
  if (error instanceof TransferOcrRateLimitError) return true;
  const message = error instanceof Error ? error.message : "";
  return /429|quota|rate limit|resource exhausted|too many requests|quá thời gian|timeout|fetch failed|network/iu.test(message);
}

async function refreshLegacyOfficeExtraction(mailboxId: string, meta: TransferFileRecord) {
  if (meta.extractionVersion === TRANSFER_EXTRACTION_VERSION) return meta;
  if (!meta.sourcePathname || !["doc", "docx", "html"].includes(meta.extractionMethod ?? "")) return meta;
  const source = await get(meta.sourcePathname, { access: "private", useCache: false });
  if (!source || source.statusCode !== 200) return meta;
  const buffer = await streamBuffer(source.stream);
  const extracted = await extractTransferredFile(buffer, meta.name, meta.contentType);
  if (extracted.text.length < 20) return meta;
  const textPathname = meta.textPathname || transferTextPath(mailboxId, meta.id);
  await writeJson(textPathname, { text: extracted.text });
  const refreshed: TransferFileRecord = {
    ...meta,
    updatedAt: new Date().toISOString(),
    status: extracted.partial ? "ocr_partial" : "ready",
    extractionMethod: extracted.method,
    extractionVersion: TRANSFER_EXTRACTION_VERSION,
    textPathname,
    characters: extracted.text.length,
    totalPages: extracted.totalPages,
    processedPages: extracted.processedPages,
    warnings: [...new Set([...meta.warnings, ...extracted.warnings])],
    error: null,
    nextOcrAttemptAt: null,
  };
  await writeJson(transferMetaPath(mailboxId, meta.id), refreshed);
  return refreshed;
}

async function readTransferPayload(meta: TransferFileRecord) {
  const text = meta.textPathname ? await readJson<{ text: string }>(meta.textPathname) : null;
  return { meta, text: text?.text ?? "" };
}

export async function processTransferredBlob(input: {
  mailboxId: string;
  fileId: string;
  name: string;
  size: number;
  contentType: string;
  sourcePathname: string;
  sourceBuffer?: Buffer;
}) {
  const now = new Date().toISOString();
  const base: TransferFileRecord = {
    id: input.fileId,
    name: input.name,
    size: input.size,
    contentType: input.contentType,
    sourcePathname: input.sourcePathname,
    createdAt: now,
    updatedAt: now,
    status: "processing",
    extractionMethod: null,
    extractionVersion: TRANSFER_EXTRACTION_VERSION,
    textPathname: null,
    characters: 0,
    totalPages: 0,
    processedPages: 0,
    warnings: [],
    error: null,
    nextOcrAttemptAt: null,
  };
  await writeJson(transferMetaPath(input.mailboxId, input.fileId), base);

  try {
    let buffer = input.sourceBuffer;
    if (!buffer) {
      const source = await get(input.sourcePathname, { access: "private", useCache: false });
      if (!source || source.statusCode !== 200) throw new Error("Không đọc lại được file vừa tải lên.");
      buffer = await streamBuffer(source.stream);
    }
    const extracted = await extractTransferredFile(buffer, input.name, input.contentType, { deferPdfOcr: true });
    if (extracted.method === "pdf_ocr" && extracted.partial) {
      const queued: TransferFileRecord = {
        ...base,
        updatedAt: new Date().toISOString(),
        status: "ocr_partial",
        extractionMethod: "pdf_ocr",
        totalPages: extracted.totalPages,
        processedPages: 0,
      };
      await writeJson(transferMetaPath(input.mailboxId, input.fileId), queued);
      return queued;
    }
    if (extracted.text.length < 20) throw new Error("File không chứa đủ nội dung chữ để đọc.");
    const textPathname = transferTextPath(input.mailboxId, input.fileId);
    await writeJson(textPathname, { text: extracted.text });
    const completed: TransferFileRecord = {
      ...base,
      updatedAt: new Date().toISOString(),
      status: "ready",
      extractionMethod: extracted.method,
      textPathname,
      characters: extracted.text.length,
      totalPages: extracted.totalPages,
      processedPages: extracted.processedPages,
      warnings: extracted.warnings,
    };
    await writeJson(transferMetaPath(input.mailboxId, input.fileId), completed);
    return completed;
  } catch (error) {
    const failed: TransferFileRecord = {
      ...base,
      updatedAt: new Date().toISOString(),
      status: "failed",
      error: error instanceof Error ? error.message : "Không thể xử lý file.",
    };
    await writeJson(transferMetaPath(input.mailboxId, input.fileId), failed);
    return failed;
  }
}

export async function listTransferredFiles(key: string) {
  const mailboxId = transferMailboxId(key);
  const prefix = `transfers/${mailboxId}/`;
  const records: TransferFileRecord[] = [];
  let cursor: string | undefined;
  do {
    const result = await list({ prefix, cursor, limit: 1000 });
    const metas = result.blobs.filter((blob) => blob.pathname.endsWith("/meta.json"));
    for (const meta of metas) {
      const record = await readJson<TransferFileRecord>(meta.pathname).catch(() => null);
      if (record) records.push(record);
    }
    cursor = result.cursor;
  } while (cursor);
  return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 100);
}

export async function readTransferredFile(key: string, fileId: string) {
  const mailboxId = transferMailboxId(key);
  const meta = await readJson<TransferFileRecord>(transferMetaPath(mailboxId, fileId));
  if (!meta) return null;
  return readTransferPayload(meta);
}

export async function refreshTransferredFileExtraction(key: string, fileId: string) {
  const mailboxId = transferMailboxId(key);
  const initialMeta = await readJson<TransferFileRecord>(transferMetaPath(mailboxId, fileId));
  if (!initialMeta) return null;
  const meta = await refreshLegacyOfficeExtraction(mailboxId, initialMeta);
  return readTransferPayload(meta);
}

export async function reprocessTransferredPdf(key: string, fileId: string) {
  const mailboxId = transferMailboxId(key);
  const pathname = transferMetaPath(mailboxId, fileId);
  const checkpointPathname = transferOcrCheckpointPath(mailboxId, fileId);
  const initial = await readJson<TransferFileRecord>(pathname);
  if (!initial) return null;
  const isPdf = initial.contentType.includes("pdf") || initial.name.toLocaleLowerCase("en").endsWith(".pdf");
  const transientFailure = initial.status === "failed" && retryableOcrError(new Error(initial.error ?? ""));
  const needsFullOcr = isPdf && (
    initial.status === "ocr_partial" ||
    initial.status === "processing" ||
    transientFailure ||
    (initial.extractionMethod === "pdf_ocr" && initial.processedPages < initial.totalPages)
  );
  if (!needsFullOcr || initial.status === "ready") return readTransferPayload(initial);
  if (unexpired(initial.nextOcrAttemptAt)) return readTransferPayload(initial);
  const processingAge = Date.now() - Date.parse(initial.updatedAt);
  if (initial.status === "processing" && Number.isFinite(processingAge) && processingAge < OCR_LEASE_MS) {
    return readTransferPayload(initial);
  }

  const leaseAttempt = await acquireOcrLease(mailboxId, fileId);
  const lease = leaseAttempt.lease;
  if (!lease) {
    const busyUntil = leaseAttempt.busyUntil ? Date.parse(leaseAttempt.busyUntil) : Number.NaN;
    const retryAt = new Date(
      Number.isFinite(busyUntil)
        ? Math.min(busyUntil, Date.now() + OCR_BUSY_RETRY_MS)
        : Date.now() + OCR_BUSY_RETRY_MS,
    ).toISOString();
    const queued: TransferFileRecord = {
      ...initial,
      updatedAt: new Date().toISOString(),
      status: "ocr_partial",
      error: "Đang chờ lượt OCR hiện tại hoàn tất",
      nextOcrAttemptAt: retryAt,
    };
    await writeJson(pathname, queued);
    return readTransferPayload(queued);
  }

  let checkpoint = await readJson<TransferOcrCheckpoint>(checkpointPathname).catch(() => null);
  if (!checkpoint || checkpoint.version !== OCR_CHECKPOINT_VERSION) {
    checkpoint = { version: OCR_CHECKPOINT_VERSION, totalPages: 0, pages: [] };
  }
  let current: TransferFileRecord = {
    ...initial,
    updatedAt: new Date().toISOString(),
    status: "processing",
    extractionMethod: "pdf_ocr",
    textPathname: null,
    characters: 0,
    processedPages: contiguousPageCount(checkpoint.pages),
    warnings: [],
    error: null,
    nextOcrAttemptAt: null,
  };
  await writeJson(pathname, current);

  try {
    const source = await get(initial.sourcePathname, { access: "private", useCache: false });
    if (!source || source.statusCode !== 200) throw new Error("Không đọc lại được file PDF gốc.");
    const buffer = await streamBuffer(source.stream);
    const startPage = contiguousPageCount(checkpoint.pages) + 1;
    const batch = await ocrTransferredPdfBatch(buffer, {
      startPage,
      maxPages: OCR_PAGES_PER_RUN,
      onPageStart: async () => {
        await refreshOcrLease(mailboxId, lease);
      },
      onPage: async (page, totalPages) => {
        if (checkpoint.totalPages > 0 && checkpoint.totalPages !== totalPages) {
          throw new Error("Tổng số trang PDF đã thay đổi trong lúc OCR.");
        }
        checkpoint.totalPages = totalPages;
        checkpoint.pages[page.page - 1] = page.text;
        await writeJson(checkpointPathname, checkpoint);
        const processedPages = contiguousPageCount(checkpoint.pages);
        current = {
          ...current,
          updatedAt: new Date().toISOString(),
          totalPages,
          processedPages,
          status: "processing",
        };
        await writeJson(pathname, current);
        await refreshOcrLease(mailboxId, lease);
      },
    });

    const processedPages = contiguousPageCount(checkpoint.pages);
    if (!batch.complete || processedPages < batch.totalPages) {
      const paused: TransferFileRecord = {
        ...current,
        updatedAt: new Date().toISOString(),
        status: "ocr_partial",
        totalPages: batch.totalPages,
        processedPages,
        nextOcrAttemptAt: null,
      };
      await writeJson(pathname, paused);
      return readTransferPayload(paused);
    }

    const text = normalizeTransferredText(
      checkpoint.pages.slice(0, batch.totalPages).filter((page): page is string => typeof page === "string").join("\n\n"),
    );
    if (text.length < 20) throw new Error("PDF không chứa đủ nội dung chữ để đọc.");
    const textPathname = transferTextPath(mailboxId, initial.id);
    await writeJson(textPathname, { text });
    const completed: TransferFileRecord = {
      ...current,
      updatedAt: new Date().toISOString(),
      status: "ready",
      extractionMethod: "pdf_ocr",
      extractionVersion: TRANSFER_EXTRACTION_VERSION,
      textPathname,
      characters: text.length,
      totalPages: batch.totalPages,
      processedPages: batch.totalPages,
      warnings: [],
      error: null,
      nextOcrAttemptAt: null,
    };
    await writeJson(pathname, completed);
    await del(checkpointPathname).catch(() => undefined);
    return readTransferPayload(completed);
  } catch (error) {
    const processedPages = contiguousPageCount(checkpoint.pages);
    if (retryableOcrError(error)) {
      const retryAfterMs = error instanceof TransferOcrRateLimitError
        ? error.retryAfterMs
        : OCR_TRANSIENT_RETRY_MS;
      const paused: TransferFileRecord = {
        ...current,
        updatedAt: new Date().toISOString(),
        status: "ocr_partial",
        totalPages: checkpoint.totalPages || current.totalPages,
        processedPages,
        warnings: [],
        error: null,
        nextOcrAttemptAt: new Date(Date.now() + retryAfterMs).toISOString(),
      };
      await writeJson(pathname, paused);
      return readTransferPayload(paused);
    }
    const failed: TransferFileRecord = {
      ...current,
      updatedAt: new Date().toISOString(),
      status: "failed",
      totalPages: checkpoint.totalPages || current.totalPages,
      processedPages,
      error: error instanceof Error ? error.message : "Không thể OCR đầy đủ PDF.",
      nextOcrAttemptAt: null,
    };
    await writeJson(pathname, failed);
    return readTransferPayload(failed);
  } finally {
    await releaseOcrLease(mailboxId, lease);
  }
}

export async function deleteTransferredFile(key: string, fileId: string) {
  const mailboxId = transferMailboxId(key);
  const prefix = `${transferBasePath(mailboxId, fileId)}/`;
  const result = await list({ prefix, limit: 1000 });
  if (result.blobs.length) await del(result.blobs.map((blob) => blob.url));
  return { deleted: result.blobs.length };
}
