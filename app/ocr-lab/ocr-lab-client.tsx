"use client";

import { FormEvent, useState } from "react";

type PageResult = {
  page: number;
  similarity: number;
  chosenPass: "literal" | "structure" | "consensus";
  chosenScore: number;
  literalScore: number;
  structureScore: number;
  consensusScore: number | null;
  text: string;
};

type LabResult = {
  sourceUrl: string;
  model: string;
  totalPages: number;
  processedPages: number;
  truncated: boolean;
  embedded: { text: string; score: number; characters: number };
  ocr: { text: string; score: number; characters: number; pages: PageResult[] };
  recommendation: "prefer_ocr" | "keep_embedded" | "manual_review";
  warnings: string[];
};

function scoreLabel(value: number) {
  return `${Math.round(value * 100)}%`;
}

function recommendationLabel(value: LabResult["recommendation"]) {
  if (value === "prefer_ocr") return "OCR đang tốt hơn lớp chữ PDF";
  if (value === "keep_embedded") return "Nên giữ lớp chữ PDF hiện tại";
  return "Cần kiểm tra thủ công trước khi dùng";
}

export default function OcrLabClient() {
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<LabResult | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/ocr-lab", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, maxPages }),
      });
      const payload = (await response.json().catch(() => ({}))) as LabResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Không thể chạy OCR thử nghiệm.");
      setResult(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Không thể chạy OCR thử nghiệm.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form className="ocrLabForm" onSubmit={submit}>
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
        <label className="ocrPageLimit">
          <span>Số trang thử</span>
          <select value={maxPages} onChange={(event) => setMaxPages(Number(event.target.value))}>
            {[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value} trang</option>)}
          </select>
        </label>
        <button type="submit" disabled={loading}>{loading ? "Đang OCR và đối chiếu…" : "Chạy thử OCR"}</button>
      </form>

      {error ? <p className="ocrLabError" role="alert">{error}</p> : null}

      {result ? (
        <section className="ocrLabResult">
          <div className="ocrSummaryGrid">
            <article>
              <span>Lớp chữ PDF</span>
              <strong>{scoreLabel(result.embedded.score)}</strong>
              <small>{result.embedded.characters.toLocaleString("vi-VN")} ký tự</small>
            </article>
            <article>
              <span>OCR nhiều lượt</span>
              <strong>{scoreLabel(result.ocr.score)}</strong>
              <small>{result.ocr.characters.toLocaleString("vi-VN")} ký tự</small>
            </article>
            <article>
              <span>Kết luận thử nghiệm</span>
              <strong className="ocrRecommendation">{recommendationLabel(result.recommendation)}</strong>
              <small>{result.processedPages}/{result.totalPages} trang · {result.model}</small>
            </article>
          </div>

          <div className="ocrWarnings">
            {result.warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>

          <div className="ocrComparison">
            <article>
              <header><h2>Lớp chữ PDF hiện tại</h2><span>{scoreLabel(result.embedded.score)}</span></header>
              <pre>{result.embedded.text || "PDF không có lớp chữ đủ dùng."}</pre>
            </article>
            <article>
              <header><h2>Kết quả OCR đã đối chiếu</h2><span>{scoreLabel(result.ocr.score)}</span></header>
              <pre>{result.ocr.text}</pre>
            </article>
          </div>

          <section className="ocrPageDetails">
            <h2>Độ nhất quán từng trang</h2>
            <div className="ocrPageTable">
              <div className="ocrPageRow ocrPageHeader">
                <span>Trang</span><span>Lượt A</span><span>Lượt B</span><span>Giống nhau</span><span>Bản dùng</span>
              </div>
              {result.ocr.pages.map((page) => (
                <div className="ocrPageRow" key={page.page}>
                  <span>{page.page}</span>
                  <span>{scoreLabel(page.literalScore)}</span>
                  <span>{scoreLabel(page.structureScore)}</span>
                  <span>{scoreLabel(page.similarity)}</span>
                  <span>{page.chosenPass === "consensus" ? "Đối chiếu" : page.chosenPass === "literal" ? "Lượt A" : "Lượt B"}</span>
                </div>
              ))}
            </div>
          </section>
        </section>
      ) : null}
    </>
  );
}
