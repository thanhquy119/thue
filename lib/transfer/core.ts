import { createHash, randomUUID } from "node:crypto";

export const TRANSFER_KEY_MIN_LENGTH = 20;
export const TRANSFER_MAX_FILE_BYTES = 50_000_000;
export const TRANSFER_UPLOAD_CHUNK_BYTES = 2_500_000;
export const TRANSFER_MAX_UPLOAD_CHUNKS = Math.ceil(TRANSFER_MAX_FILE_BYTES / TRANSFER_UPLOAD_CHUNK_BYTES);
export const TRANSFER_ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.ms-excel.sheet.binary.macroenabled.12",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  "application/vnd.ms-excel.template.macroenabled.12",
  "application/vnd.oasis.opendocument.spreadsheet",
  "text/csv",
  "application/csv",
  "text/tab-separated-values",
  "text/plain",
  "text/markdown",
  "text/html",
  "application/rtf",
  "application/octet-stream",
] as const;

export type TransferFileStatus = "processing" | "ready" | "ocr_partial" | "unsupported" | "failed";

export type TransferFileRecord = {
  id: string;
  name: string;
  size: number;
  contentType: string;
  sourcePathname: string;
  createdAt: string;
  updatedAt: string;
  status: TransferFileStatus;
  extractionMethod: string | null;
  extractionVersion?: number;
  textPathname: string | null;
  characters: number;
  totalPages: number;
  processedPages: number;
  warnings: string[];
  error: string | null;
  nextOcrAttemptAt?: string | null;
};

export type TransferUploadSession = {
  mailboxId: string;
  fileId: string;
  name: string;
  size: number;
  contentType: string;
  totalChunks: number;
  createdAt: string;
};

export function normalizeTransferKey(value: string) {
  return value.replace(/[^a-z0-9]/giu, "").toLocaleUpperCase("en");
}

export function validTransferKey(value: string) {
  const normalized = normalizeTransferKey(value);
  return normalized.length >= TRANSFER_KEY_MIN_LENGTH && normalized.length <= 80;
}

export function transferMailboxId(key: string) {
  const normalized = normalizeTransferKey(key);
  if (!validTransferKey(normalized)) throw new Error("Mã kết nối không hợp lệ.");
  return createHash("sha256").update(`thue-transfer-v1:${normalized}`).digest("hex");
}

export function safeTransferFilename(value: string) {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f\u007f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  return cleaned || "tai-lieu";
}

export function transferFileId(value?: string) {
  const cleaned = value?.replace(/[^a-z0-9-]/giu, "").slice(0, 80) ?? "";
  return cleaned.length >= 12 ? cleaned : randomUUID();
}

function assertMailboxId(mailboxId: string) {
  if (!/^[a-f0-9]{64}$/u.test(mailboxId)) throw new Error("Hộp file không hợp lệ.");
}

export function transferBasePath(mailboxId: string, fileId: string) {
  assertMailboxId(mailboxId);
  if (!/^[a-z0-9-]{12,80}$/iu.test(fileId)) throw new Error("Mã file không hợp lệ.");
  return `transfers/${mailboxId}/${fileId}`;
}

export function transferSourcePath(mailboxId: string, fileId: string, filename: string) {
  return `${transferBasePath(mailboxId, fileId)}/source/${safeTransferFilename(filename)}`;
}

export function transferUploadSessionPath(mailboxId: string, fileId: string) {
  return `${transferBasePath(mailboxId, fileId)}/upload/session.json`;
}

export function transferUploadChunkPrefix(mailboxId: string, fileId: string) {
  return `${transferBasePath(mailboxId, fileId)}/upload/chunks/`;
}

export function transferUploadChunkPath(mailboxId: string, fileId: string, index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= TRANSFER_MAX_UPLOAD_CHUNKS) {
    throw new Error("Thứ tự phần tải lên không hợp lệ.");
  }
  return `${transferUploadChunkPrefix(mailboxId, fileId)}${String(index).padStart(3, "0")}.bin`;
}

export function transferMetaPath(mailboxId: string, fileId: string) {
  return `${transferBasePath(mailboxId, fileId)}/meta.json`;
}

export function transferTextPath(mailboxId: string, fileId: string) {
  return `${transferBasePath(mailboxId, fileId)}/text.json`;
}

export function transferOcrCheckpointPath(mailboxId: string, fileId: string) {
  return `${transferBasePath(mailboxId, fileId)}/ocr/checkpoint.json`;
}

export function transferOcrLeasePath(mailboxId: string) {
  assertMailboxId(mailboxId);
  // Tất cả hộp file dùng chung một khóa OCR để không cộng dồn request trên cùng API key.
  return "transfers/ocr-global-lease.json";
}
