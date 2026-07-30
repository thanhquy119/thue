"use client";

import { useEffect, useRef } from "react";
import {
  transferOcrNeedsRun,
  transferOcrRetryPending,
  type TransferOcrScheduleFile,
} from "@/lib/transfer/ocr-scheduling";

const STORAGE_KEY = "thue-transfer-key-v1";
const REFRESH_MS = 4_000;

type TransferFileSummary = TransferOcrScheduleFile & {
  id: string;
  textPathname: string | null;
};

type TransferListPayload = {
  files?: TransferFileSummary[];
};

function readyToOpen(file: TransferFileSummary) {
  if (file.status !== "ready" || !file.textPathname) return false;
  if (file.extractionMethod !== "pdf_ocr") return true;
  return file.totalPages > 0 && file.processedPages === file.totalPages;
}

function sizeText(value: string) {
  return value.split("·")[0]?.trim() || value.trim();
}

function progressText(file: TransferFileSummary) {
  return file.totalPages > 0 ? `${file.processedPages}/${file.totalPages} trang` : "toàn bộ nội dung";
}

function statusCopy(file: TransferFileSummary, size: string) {
  if (readyToOpen(file)) {
    return file.extractionMethod === "spreadsheet"
      ? `${size} · Sẵn sàng xem và xử lý`
      : `${size} · Sẵn sàng đọc và nghe`;
  }
  if (file.status === "processing") {
    return file.extractionMethod === "spreadsheet"
      ? `${size} · Đang đọc cấu trúc bảng tính`
      : `${size} · Đang OCR chậm ${progressText(file)}`;
  }
  if (file.status === "ocr_partial") {
    return transferOcrRetryPending(file.nextOcrAttemptAt)
      ? `${size} · Tạm nghỉ để bảo vệ hạn mức · ${progressText(file)}`
      : `${size} · Chờ lượt OCR tiếp theo · ${progressText(file)}`;
  }
  if (file.status === "failed") return `${size} · ${file.error || "Xử lý file thất bại"}`;
  return size;
}

function updateText(element: Element | null, value: string) {
  if (element && element.textContent !== value) element.textContent = value;
}

function updateUploadMessage(files: TransferFileSummary[]) {
  const message = document.querySelector<HTMLElement>(".transferMessage");
  const newest = files[0];
  if (!message || newest?.extractionMethod !== "spreadsheet" || newest.status !== "ready") return;
  if (/chuyển thành nội dung có thể nghe|chuyển được nội dung/iu.test(message.textContent ?? "")) {
    updateText(message, "Đã tải bảng tính. File sẵn sàng để xem và xử lý.");
  }
}

function polishTransferDom(files: TransferFileSummary[]) {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(".transferFileOpen")];
  buttons.forEach((button, index) => {
    const file = files[index];
    if (!file) return;
    const canOpen = readyToOpen(file);
    if (button.disabled === canOpen) button.disabled = !canOpen;
    button.setAttribute("aria-disabled", canOpen ? "false" : "true");
    const meta = button.querySelector("span");
    const size = sizeText(meta?.textContent ?? "");
    updateText(meta, statusCopy(file, size));
  });
  updateUploadMessage(files);
}

export default function TransferPolishEnhancer() {
  const filesRef = useRef<TransferFileSummary[]>([]);
  const processingRef = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const schedulePolish = () => {
      if (frameRef.current != null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        polishTransferDom(filesRef.current);
      });
    };

    const processPdf = async (file: TransferFileSummary, key: string) => {
      if (processingRef.current) return;
      processingRef.current = file.id;
      try {
        await fetch(`/api/transfer/files/${encodeURIComponent(file.id)}/process`, {
          method: "POST",
          headers: { "x-transfer-key": key },
          cache: "no-store",
        });
        document.querySelector<HTMLButtonElement>(".transferListHeading button")?.click();
      } catch {
        // Danh sách sẽ tiếp tục hiển thị tiến độ đã lưu và tự thử lại ở lượt sau.
      } finally {
        processingRef.current = null;
      }
    };

    const refresh = async () => {
      const key = window.localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
      if (!key) {
        filesRef.current = [];
        schedulePolish();
        return;
      }
      try {
        const response = await fetch("/api/transfer/files", {
          headers: { "x-transfer-key": key },
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = await response.json() as TransferListPayload;
        if (cancelled) return;
        const files = payload.files ?? [];
        filesRef.current = files;
        schedulePolish();
        const nextFile = files.find((file) => transferOcrNeedsRun(file));
        if (nextFile) void processPdf(nextFile, key);
      } catch {
        schedulePolish();
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    const observer = new MutationObserver(schedulePolish);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      observer.disconnect();
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return null;
}
