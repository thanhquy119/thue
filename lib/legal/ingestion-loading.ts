import type { TaxSearchResponse } from "./types.ts";

export type IngestionProgress = NonNullable<TaxSearchResponse["ingestion"]>;

export function ingestionLoadingEstimate(progress: IngestionProgress) {
  if (progress.status !== "processing") {
    return "Thời gian hoàn tất chưa xác định. Hệ thống đang chờ lượt xử lý lại; dịch vụ đọc văn bản có thể đang quá tải.";
  }
  if (!Number.isFinite(progress.totalPages) || progress.totalPages <= 0) {
    return "Thời gian dự kiến: khoảng 2–5 phút. Đang kiểm tra số trang; văn bản dài có thể cần thêm thời gian.";
  }
  const remaining = Math.max(0, progress.totalPages - Math.max(0, progress.processedPages));
  const groups = Math.max(1, Math.ceil(remaining / 3));
  const minimum = Math.max(1, Math.ceil(groups * 20 / 60));
  const maximum = Math.max(minimum + 1, Math.ceil(groups * 60 / 60) + 1);
  return `Thời gian còn lại dự kiến: khoảng ${minimum}–${maximum} phút. Có thể lâu hơn nếu cần đọc lại hoặc dịch vụ quá tải.`;
}
