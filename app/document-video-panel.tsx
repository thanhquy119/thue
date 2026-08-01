"use client";

import {useEffect, useRef, useState} from "react";
import type {LegalVideoPublicJob} from "@/lib/video/types";

type DocumentVideoPanelProps = {
  documentNumber: string;
};

type VideoLookupResponse = {
  ok?: boolean;
  job?: LegalVideoPublicJob | null;
};

const ACTIVE_STATUSES = new Set(["queued", "summarizing", "synthesizing", "rendering"]);

function progressLabel(job: LegalVideoPublicJob) {
  if (job.status === "queued") return "Video chi tiết đã được xếp hàng";
  if (job.status === "summarizing") return "Đang đọc và tóm tắt toàn văn";
  if (job.status === "synthesizing") return "Đang tạo giọng đọc tiếng Việt";
  if (job.status === "rendering") return "Đang dựng và xuất video";
  return "Video đang được chuẩn bị";
}

export default function DocumentVideoPanel({documentNumber}: DocumentVideoPanelProps) {
  const [job, setJob] = useState<LegalVideoPublicJob | null>(null);
  const [loadedNumber, setLoadedNumber] = useState<string | null>(null);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    const refresh = async () => {
      let nextJob: LegalVideoPublicJob | null = null;
      try {
        const response = await fetch(`/api/videos/document?number=${encodeURIComponent(documentNumber)}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as VideoLookupResponse;
        if (cancelled || requestRef.current !== requestId) return;
        if (response.ok) {
          nextJob = payload.job ?? null;
          setJob(nextJob);
        }
      } catch {
        // Toàn văn vẫn hoạt động bình thường nếu trạng thái video tạm thời chưa đọc được.
      } finally {
        if (cancelled || requestRef.current !== requestId) return;
        setLoadedNumber(documentNumber);
        const delay = nextJob && ACTIVE_STATUSES.has(nextJob.status) ? 7_000 : 20_000;
        timer = setTimeout(refresh, delay);
      }
    };

    void refresh();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [documentNumber]);

  const currentJob = job?.documentNumber === documentNumber ? job : null;
  if (loadedNumber !== documentNumber && !currentJob) return null;
  if (!currentJob) return null;

  if (currentJob.status === "ready") {
    const showPlayer = openJobId === currentJob.jobId;
    return (
      <section
        aria-label="Video tóm tắt văn bản"
        style={{
          marginTop: 18,
          padding: 16,
          border: "1px solid rgba(21, 70, 54, 0.16)",
          borderRadius: 18,
          background: "rgba(247, 251, 249, 0.94)",
        }}
      >
        <button
          type="button"
          onClick={() => setOpenJobId(showPlayer ? null : currentJob.jobId)}
          style={{
            width: "100%",
            border: 0,
            borderRadius: 14,
            padding: "14px 16px",
            font: "inherit",
            fontWeight: 750,
            cursor: "pointer",
            color: "white",
            background: "#173f34",
          }}
        >
          {showPlayer ? "Ẩn video tóm tắt" : "▶ Xem video chi tiết trước khi đọc"}
        </button>
        {showPlayer ? (
          <div style={{marginTop: 14}}>
            <video
              controls
              playsInline
              preload="metadata"
              src={`/api/videos/jobs/${encodeURIComponent(currentJob.jobId)}/video`}
              style={{display: "block", width: "100%", maxHeight: "78vh", borderRadius: 14, background: "#0b1411"}}
            >
              Trình duyệt của em chưa hỗ trợ phát video.
            </video>
            <p style={{margin: "10px 2px 0", fontSize: 13, lineHeight: 1.5, opacity: 0.72}}>
              Video giúp nắm nhanh nội dung; toàn văn chính thức vẫn nằm ngay bên dưới để đối chiếu.
            </p>
          </div>
        ) : null}
      </section>
    );
  }

  if (currentJob.status === "failed") {
    return (
      <div
        aria-live="polite"
        style={{
          marginTop: 18,
          padding: "13px 16px",
          borderRadius: 14,
          background: "rgba(245, 247, 246, 0.94)",
          color: "rgba(24, 45, 38, 0.74)",
          fontWeight: 650,
        }}
      >
        Video chi tiết chưa sẵn sàng. Em vẫn có thể đọc toàn văn ngay bên dưới.
      </div>
    );
  }

  return (
    <div
      aria-live="polite"
      aria-busy="true"
      style={{
        marginTop: 18,
        padding: "14px 16px",
        borderRadius: 14,
        border: "1px solid rgba(38, 71, 60, 0.12)",
        background: "rgba(245, 248, 247, 0.9)",
        color: "rgba(24, 45, 38, 0.78)",
      }}
    >
      <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14}}>
        <div>
          <strong style={{display: "block"}}>{progressLabel(currentJob)}</strong>
          <span style={{display: "block", marginTop: 4, fontSize: 13, opacity: 0.76}}>
            Toàn văn đã đọc được ngay; nút xem video sẽ tự mở khi xử lý xong.
          </span>
        </div>
        <span style={{minWidth: 48, textAlign: "right", fontWeight: 800}}>{Math.max(1, Math.min(99, currentJob.progress))}%</span>
      </div>
      <div style={{height: 5, marginTop: 12, overflow: "hidden", borderRadius: 999, background: "rgba(23, 63, 52, 0.12)"}}>
        <div
          style={{
            width: `${Math.max(2, Math.min(99, currentJob.progress))}%`,
            height: "100%",
            borderRadius: 999,
            background: "#477c68",
            transition: "width 450ms ease",
          }}
        />
      </div>
    </div>
  );
}
