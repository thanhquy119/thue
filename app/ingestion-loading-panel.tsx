"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { ingestionLoadingEstimate, type IngestionProgress } from "@/lib/legal/ingestion-loading";

export default function IngestionLoadingPanel({ progress, onReady }: {
  progress: IngestionProgress;
  onReady: (number: string) => void;
}) {
  const [current, setCurrent] = useState(progress);
  const [paused, setPaused] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const openDocument = useEffectEvent(onReady);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;
    let failures = 0;
    let controller: AbortController | undefined;
    const poll = async () => {
      if (cancelled) return;
      // Sequential checks avoid overlapping requests and stop after ten minutes.
      attempts += 1;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 8_000);
      try {
        const response = await fetch(`/api/ingestion/status?number=${encodeURIComponent(progress.number)}`, {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Status unavailable");
        const payload = await response.json();
        if (cancelled) return;
        failures = 0;
        if (payload.revision?.validation?.accepted) {
          openDocument(progress.number);
          return;
        }
        const status = payload.status;
        if (status && ["processing", "needs_review", "failed"].includes(status.status)) {
          setCurrent({ number: progress.number, status: status.status,
            processedPages: status.processedPages, totalPages: status.totalPages, updatedAt: status.updatedAt });
          if (status.status !== "processing") {
            setPaused(true);
            return;
          }
        }
      } catch {
        if (cancelled) return;
        failures += 1;
      } finally {
        window.clearTimeout(timeout);
      }
      if (attempts >= 60 || failures >= 3) {
        setPaused(true);
        return;
      }
      timer = window.setTimeout(poll, 10_000);
    };
    timer = window.setTimeout(poll, 1_000);
    return () => {
      cancelled = true;
      controller?.abort();
      window.clearTimeout(timer);
    };
  }, [progress.number, retryToken]);

  return (
    <section className="loadingPanel" role="status" aria-live="polite">
      <div className="loadingDot" aria-hidden="true" />
      <div>
        <strong>{current.status === "processing" ? "Đang tải toàn văn…" : "Đang chờ tải lại toàn văn…"}</strong>
        <p>{current.number}{current.totalPages > 0 ? ` · Đã xử lý ${current.processedPages}/${current.totalPages} trang` : ""}</p>
        <p>{ingestionLoadingEstimate(current)}</p>
        <p>{paused ? "Chưa có kết quả mới. Em có thể kiểm tra lại bên dưới." : "Toàn văn sẽ tự mở khi xử lý xong."}</p>
        {paused ? <button type="button" onClick={() => { setPaused(false); setRetryToken((value) => value + 1); }}>Kiểm tra lại</button> : null}
      </div>
    </section>
  );
}
