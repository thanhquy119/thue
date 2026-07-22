"use client";

import { type FormEvent, useRef, useState } from "react";
import {
  chunkOcrPages,
  formatOcrPageSelection,
  parseOcrPageSelection,
} from "@/lib/legal/ocr-page-selection";
import {
  OCR_MODEL_OPTIONS,
  type OcrModelChoice,
} from "@/lib/legal/ocr-models";
import { OCR_SAMPLES, type OcrSample } from "@/lib/legal/ocr-samples";
import OcrMainPreview from "./ocr-main-preview";
import type { LabResult } from "./ocr-lab-types";
import {
  mergeResults,
  passLabel,
  recommendationLabel,
  scoreLabel,
} from "./ocr-lab-utils";

export default function OcrLabClient() {
  const [url, setUrl] = useState("");
  const [pageMode, setPageMode] = useState("3");
  const [customPages, setCustomPages] = useState("12-14");
  const [modelChoice, setModelChoice] = useState<OcrModelChoice>("auto");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<LabResult | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  async function requestBatch(controller: AbortController, options: { maxPages?: number; pages?: number[] }) {
    const response = await fetch("/api/ocr-lab", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, model: modelChoice, ...options }),
    });
    const payload = (await response.json().catch(() => ({}))) as LabResult & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Không thể chạy OCR thử nghiệm.");
    return payload;
  }

  async function processSelectedPages(controller: AbortController, pages: number[]) {
    const batches: LabResult[] = [];
    const chunks = chunkOcrPages(pages, 3);
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index] ?? [];
      setProgress(`Đang phân tích trang ${chunk.join(", ")} · đợt ${index + 1}/${chunks.length}…`);
      try {
        batches.push(await requestBatch(controller, { pages: chunk }));
      } catch (batchError) {
        if (controller.signal.aborted) throw batchError;
        if (chunk.length === 1) throw batchError;
        for (const page of chunk) {
          setProgress(`Đang thử lại riêng trang ${page}…`);
          batches.push(await requestBatch(controller, { pages: [page] }));
        }
      }
      setResult(mergeResults(batches));
    }
    setProgress(`Đã hoàn tất ${pages.length} trang kiểm thử: ${pages.join(", ")}.`);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError("");
    setProgress("");
    setResult(null);

    try {
      if (pageMode === "custom") {
        const pages = parseOcrPageSelection(customPages);
        if (!pages.length) throw new Error("Hãy nhập ít nhất một trang cần kiểm thử.");
        await processSelectedPages(controller, pages);
        return;
      }

      if (pageMode !== "full") {
        setProgress(`Đang phân tích ${pageMode} trang đầu…`);
        const payload = await requestBatch(controller, { maxPages: Number(pageMode) });
        setResult(payload);
        setProgress(`Đã xử lý ${payload.processedPages}/${payload.totalPages} trang.`);
        return;
      }

      const batches: LabResult[] = [];
      setProgress("Đang đọc hai trang đầu để xác định độ dài tệp…");
      const first = await requestBatch(controller, { pages: [1, 2] });
      batches.push(first);
      setResult(mergeResults(batches));

      for (let start = 3; start <= first.totalPages; start += 2) {
        const selectedPages = [start, start + 1].filter((page) => page <= first.totalPages);
        setProgress(`Đang phân tích trang ${selectedPages.join("–")}/${first.totalPages}…`);
        try {
          batches.push(await requestBatch(controller, { pages: selectedPages }));
        } catch (batchError) {
          if (controller.signal.aborted) throw batchError;
          if (selectedPages.length === 1) throw batchError;
          for (const page of selectedPages) {
            setProgress(`Đang thử lại riêng trang ${page}/${first.totalPages}…`);
            batches.push(await requestBatch(controller, { pages: [page] }));
          }
        }
        setResult(mergeResults(batches));
      }
      setProgress(`Đã hoàn tất toàn bộ ${first.totalPages} trang.`);
    } catch (requestError) {
      setError(
        controller.signal.aborted
          ? "Đã dừng quá trình phân tích. Các trang hoàn tất trước đó vẫn được giữ trên màn hình."
          : requestError instanceof Error ? requestError.message : "Không thể chạy OCR thử nghiệm.",
      );
    } finally {
      controllerRef.current = null;
      setLoading(false);
    }
  }

  function chooseSample(sample: OcrSample) {
    setUrl(sample.url);
    setCustomPages(formatOcrPageSelection(sample.testPages));
    setPageMode("custom");
    setError("");
    setProgress("");
    setResult(null);
  }

  const selectedModel = OCR_MODEL_OPTIONS.find((option) => option.value === modelChoice);

  return (
    <>
      <section className="ocrSamples">
        <header>
          <div>
            <span>Bộ mẫu kiểm thử chính thức</span>
            <h2>PDF lấy trực tiếp từ Văn bản Chính phủ</h2>
          </div>
          <small>Chạm một mẫu để tự điền các trang khó đại diện, không cần chạy toàn bộ tệp.</small>
        </header>
        <div className="ocrSampleGrid">
          {OCR_SAMPLES.map((sample) => (
            <button
              type="button"
              key={sample.url}
              onClick={() => chooseSample(sample)}
              className={url === sample.url ? "isSelected" : ""}
              disabled={loading}
            >
              <strong>{sample.label}</strong>
              <span>{sample.description}</span>
              <span className="ocrSampleCases">Trang {formatOcrPageSelection(sample.testPages)} · {sample.cases.join(" · ")}</span>
            </button>
          ))}
        </div>
      </section>

      <form className="ocrLabForm ocrLabForm--withModel" onSubmit={submit}>
        <label>
          <span>Liên kết trực tiếp tới PDF chính thức</span>
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://.../van-ban.pdf"
            required
          />
        </label>
        <label className="ocrModelChoice">
          <span>Model OCR</span>
          <select
            value={modelChoice}
            onChange={(event) => setModelChoice(event.target.value as OcrModelChoice)}
            disabled={loading}
          >
            {OCR_MODEL_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="ocrPageLimit">
          <span>Phạm vi thử</span>
          <select value={pageMode} onChange={(event) => setPageMode(event.target.value)} disabled={loading}>
            {[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value} trang đầu</option>)}
            <option value="custom">Trang cụ thể</option>
            <option value="full">Toàn bộ tệp</option>
          </select>
        </label>
        <div className="ocrFormActions">
          <button type="submit" disabled={loading}>{loading ? "Đang xử lý…" : "Chạy thử OCR"}</button>
          {loading ? <button className="ocrCancelButton" type="button" onClick={() => controllerRef.current?.abort()}>Dừng</button> : null}
        </div>
        {pageMode === "custom" ? (
          <label className="ocrCustomPages">
            <span>Trang cần kiểm thử</span>
            <input
              value={customPages}
              onChange={(event) => setCustomPages(event.target.value)}
              placeholder="Ví dụ: 12-14, 20, 25"
              disabled={loading}
              required
            />
          </label>
        ) : null}
      </form>

      <p className="ocrModelHint"><strong>{selectedModel?.label}:</strong> {selectedModel?.description}</p>
      {pageMode === "full" ? <p className="ocrFullHint">Chế độ toàn tệp chia PDF thành từng đợt 1–2 trang để tránh timeout. Trang có lớp chữ tốt được giữ nguyên; OCR chỉ tập trung vào trang scan hoặc trang có lớp chữ kém.</p> : null}
      {pageMode === "custom" ? <p className="ocrFullHint">Có thể nhập từng trang hoặc khoảng trang, ví dụ <strong>12-14, 20</strong>. Hệ thống tự chia thành đợt tối đa ba trang và vẫn ghép bảng giữa các trang liên tiếp.</p> : null}
      {progress ? <p className="ocrProgress" role="status">{progress}</p> : null}
      {error ? <p className="ocrLabError" role="alert">{error}</p> : null}

      {result ? (
        <section className="ocrLabResult">
          <div className="ocrSummaryGrid">
            <article><span>Lớp chữ PDF</span><strong>{scoreLabel(result.embedded.score)}</strong><small>{result.embedded.characters.toLocaleString("vi-VN")} ký tự</small></article>
            <article><span>Kết quả sau xử lý</span><strong>{scoreLabel(result.ocr.score)}</strong><small>{result.ocr.characters.toLocaleString("vi-VN")} ký tự</small></article>
            <article><span>Kết luận thử nghiệm</span><strong className="ocrRecommendation">{recommendationLabel(result.recommendation)}</strong><small>{result.processedPages}/{result.totalPages} trang · {result.model}</small></article>
          </div>

          <div className="ocrWarnings">{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
          <OcrMainPreview pages={result.ocr.pages} />

          <div className="ocrComparison">
            <article><header><h2>Lớp chữ PDF hiện tại</h2><span>{scoreLabel(result.embedded.score)}</span></header><pre>{result.embedded.text || "PDF không có lớp chữ đủ dùng."}</pre></article>
            <article><header><h2>Kết quả sau OCR và đối chiếu</h2><span>{scoreLabel(result.ocr.score)}</span></header><pre>{result.ocr.text || "Không tìm thấy nội dung chữ đủ tin cậy."}</pre></article>
          </div>

          <section className="ocrPageDetails">
            <h2>Độ nhất quán từng trang</h2>
            <div className="ocrPageTable">
              <div className="ocrPageRow ocrPageHeader"><span>Trang</span><span>Lượt A</span><span>Lượt B</span><span>Giống nhau</span><span>Bản dùng</span></div>
              {result.ocr.pages.map((page) => (
                <div className="ocrPageRow" key={page.page}>
                  <span>{page.page}</span>
                  <span>{page.chosenPass === "embedded" ? "—" : scoreLabel(page.literalScore)}</span>
                  <span>{page.chosenPass === "embedded" ? "—" : scoreLabel(page.structureScore)}</span>
                  <span>{page.chosenPass === "embedded" ? "—" : scoreLabel(page.similarity)}</span>
                  <span>{passLabel(page.chosenPass)}</span>
                </div>
              ))}
            </div>
          </section>
        </section>
      ) : null}
    </>
  );
}
