export const TRANSFER_OCR_STALE_PROCESSING_MS = 270_000;

export type TransferOcrScheduleFile = {
  name: string;
  contentType: string;
  updatedAt: string;
  status: "processing" | "ready" | "ocr_partial" | "unsupported" | "failed";
  extractionMethod: string | null;
  totalPages: number;
  processedPages: number;
  error: string | null;
  nextOcrAttemptAt?: string | null;
};

export function transferOcrRetryPending(value: string | null | undefined, now = Date.now()) {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) && timestamp > now;
}

function staleProcessing(file: TransferOcrScheduleFile, now: number, staleMs: number) {
  const updatedAt = Date.parse(file.updatedAt);
  return !Number.isFinite(updatedAt) || now - updatedAt >= staleMs;
}

function retryableFailure(file: TransferOcrScheduleFile) {
  return file.status === "failed" &&
    /429|quota|rate limit|resource exhausted|too many requests|quá thời gian|timeout|fetch failed|network/iu.test(file.error ?? "");
}

export function transferOcrNeedsRun(
  file: TransferOcrScheduleFile,
  now = Date.now(),
  staleMs = TRANSFER_OCR_STALE_PROCESSING_MS,
) {
  const pdf = file.contentType.includes("pdf") || file.name.toLocaleLowerCase("en").endsWith(".pdf");
  if (!pdf || file.status === "ready" || file.status === "unsupported") return false;
  if (transferOcrRetryPending(file.nextOcrAttemptAt, now)) return false;

  // Một tiến trình khác có thể đang giữ lease. Không POST lặp mỗi vài giây khi trạng thái
  // vẫn còn mới; chỉ phục hồi khi heartbeat đã thực sự quá hạn.
  if (file.status === "processing") return staleProcessing(file, now, staleMs);
  if (file.status === "ocr_partial" || retryableFailure(file)) return true;
  return file.extractionMethod === "pdf_ocr" && file.processedPages < file.totalPages;
}
