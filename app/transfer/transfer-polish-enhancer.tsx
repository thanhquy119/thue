"use client";

import { useEffect, useRef } from "react";

const STORAGE_KEY = "thue-transfer-key-v1";
const REFRESH_MS = 4_000;

type TransferFileSummary = {
  id: string;
  name: string;
  contentType: string;
  status: "processing" | "ready" | "ocr_partial" | "unsupported" | "failed";
  extractionMethod: string | null;
  textPathname: string | null;
  totalPages: number;
  processedPages: number;
  error: string | null;
};

type TransferListPayload = {
  files?: TransferFileSummary[];
};

function readyToOpen(file: TransferFileSummary) {
  if (file.status !== "ready" || !file.textPathname) return false;
  if (file.extractionMethod !== "pdf_ocr") return true;
  return file.totalPages > 0 && file.processedPages === file.totalPages;
}

function needsFullPdfOcr(file: TransferFileSummary) {
  const pdf = file.contentType.includes("pdf") || file.name.toLocaleLowerCase("en").endsWith(".pdf");
  return pdf && (
    file.status === "ocr_partial" ||
    (file.extractionMethod === "pdf_ocr" && file.processedPages < file.totalPages)
  );
}

function sizeText(value: string) {
  return value.split("·")[0]?.trim() || value.trim();
}

function statusCopy(file: TransferFileSummary, size: string) {
  if (readyToOpen(file)) return size;
  if (file.status === "processing") {
    return file.totalPages > 0
      ? `${size} · Đang OCR đầy đủ ${file.processedPages}/${file.totalPages} trang`
      : `${size} · Đang xử lý toàn bộ nội dung…`;
  }
  if (file.status === "ocr_partial") return `${size} · Đang chuẩn bị OCR toàn bộ PDF…`;
  if (file.status === "failed") return `${size} · ${file.error || "Xử lý file thất bại"}`;
  return size;
}

function updateText(element: Element | null, value: string) {
  if (element && element.textContent !== value) element.textContent = value;
}

function polishTransferDom(files: TransferFileSummary[]) {
  const helper = document.querySelector<HTMLElement>(".uploadCard small");
  if (helper && !helper.hidden) helper.hidden = true;

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

  document.querySelectorAll<HTMLElement>(".detailBadges span").forEach((badge) => {
    if (badge.textContent?.trim() === "Sẵn sàng đọc và nghe" && !badge.hidden) badge.hidden = true;
  });
  document.querySelectorAll<HTMLElement>(".transferMethod").forEach((method) => {
    if (method.textContent?.trim() === "Trích từ Word cũ" && !method.hidden) method.hidden = true;
  });
}

export default function TransferPolishEnhancer() {
  const filesRef = useRef<TransferFileSummary[]>([]);
  const processingRef = useRef(new Set<string>());
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
      if (processingRef.current.has(file.id)) return;
      processingRef.current.add(file.id);
      try {
        await fetch(`/api/transfer/files/${encodeURIComponent(file.id)}/process`, {
          method: "POST",
          headers: { "x-transfer-key": key },
          cache: "no-store",
        });
        document.querySelector<HTMLButtonElement>(".transferListHeading button")?.click();
      } catch {
        // Danh sách sẽ tiếp tục hiển thị trạng thái hiện có; lần tải trang sau có thể thử lại.
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
        for (const file of files) {
          if (needsFullPdfOcr(file)) void processPdf(file, key);
        }
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
