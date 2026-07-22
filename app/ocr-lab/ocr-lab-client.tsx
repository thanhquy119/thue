"use client";

import { type FormEvent, useRef, useState } from "react";
import { buildOcrPreviewBlocks, type OcrPreviewBlock } from "@/lib/legal/ocr-layout";
import { OCR_SAMPLES } from "@/lib/legal/ocr-samples";

type PageResult = {
  page: number;
  similarity: number;
  chosenPass: "literal" | "structure" | "consensus" | "embedded";
  chosenScore: number;
  literalScore: number;
  structureScore: number;
  consensusScore: number | null;
  text: string;
  notices?: string[];
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

function passLabel(value: PageResult["chosenPass"]) {
  if (value === "consensus") return "Đối chiếu";
  if (value === "literal") return "Lượt A";
  if (value === "structure") return "Lượt B";
  return "Lớp chữ PDF";
}

function recommendation(embeddedScore: number, ocrScore: number): LabResult["recommendation"] {
  if (ocrScore >= 0.7 && ocrScore >= embeddedScore + 0.08) return "prefer_ocr";
  if (embeddedScore >= 0.74 && embeddedScore >= ocrScore - 0.03) return "keep_embedded";
  return "manual_review";
}

function weightedScore(results: LabResult[], key: "embedded" | "ocr") {
  const totalWeight = results.reduce((sum, result) => sum + Math.max(1, result[key].characters), 0);
  return results.reduce(
    (sum, result) => sum + result[key].score * Math.max(1, result[key].characters),
    0,
  ) / Math.max(1, totalWeight);
}

function mergeResults(results: LabResult[]): LabResult {
  const pages = [...new Map(
    results.flatMap((result) => result.ocr.pages).map((page) => [page.page, page]),
  ).values()].sort((left, right) => left.page - right.page);
  const embeddedText = results.map((result) => result.embedded.text).filter(Boolean).join("\n\n");
  const ocrText = pages.map((page) => page.text).filter(Boolean).join("\n\n");
  const embeddedScore = weightedScore(results, "embedded");
  const ocrScore = pages.length
    ? pages.reduce((sum, page) => sum + page.chosenScore, 0) / pages.length
    : weightedScore(results, "ocr");
  const totalPages = Math.max(...results.map((result) => result.totalPages));
  const warnings = [...new Set(
    results
      .flatMap((result) => result.warnings)
      .filter((warning) => !/^Đợt này đã (?:OCR|xử lý) trang/iu.test(warning)),
  )];
  warnings.push(
    pages.length === totalPages
      ? `Đã hoàn tất phân tích toàn bộ ${totalPages} trang trong chế độ thử nghiệm theo từng đợt nhỏ.`
      : `Đã xử lý ${pages.length}/${totalPages} trang; kết quả đang được cập nhật dần.`,
  );

  return {
    sourceUrl: results[0].sourceUrl,
    model: results[0].model,
    totalPages,
    processedPages: pages.length,
    truncated: pages.length < totalPages,
    embedded: { text: embeddedText, score: embeddedScore, characters: embeddedText.length },
    ocr: { text: ocrText, score: ocrScore, characters: ocrText.length, pages },
    recommendation: recommendation(embeddedScore, ocrScore),
    warnings,
  };
}

function tableCellContent(value: string) {
  return value || "\u00a0";
}

function TableBlock({ block }: { block: Extract<OcrPreviewBlock, { kind: "table" }> }) {
  const headers = block.rows.slice(0, block.headerRows);
  const body = block.rows.slice(block.headerRows);
  const tableClass = `ocrDocTable ocrDocTable--${block.firstColumn}`;

  return (
    <div className="ocrDocTableWrap">
      <table className={tableClass} data-columns={block.columnCount}>
        {headers.length ? (
          <thead>
            {headers.map((row, rowIndex) => (
              <tr key={`header-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <th scope="col" key={`header-${rowIndex}-${cellIndex}`}>{tableCellContent(cell)}</th>
                ))}
              </tr>
            ))}
          </thead>
        ) : null}
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={`body-${rowIndex}-${row[0] ?? ""}`}>
              {row.map((cell, cellIndex) => {
                const isRowHeader = cellIndex === 0 && block.firstColumn !== "auto";
                const checkboxOnly = /^(?:□|☐|☑|✓|✔)(?:\s+(?:□|☐|☑|✓|✔))*$/u.test(cell.trim());
                const className = checkboxOnly ? "ocrDocTableCheckboxCell" : undefined;
                return isRowHeader
                  ? <th scope="row" className={className} key={`body-${rowIndex}-${cellIndex}`}>{tableCellContent(cell)}</th>
                  : <td className={className} key={`body-${rowIndex}-${cellIndex}`}>{tableCellContent(cell)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviewBlock({ block }: { block: OcrPreviewBlock }) {
  if (block.kind === "title") return <h2 className="ocrDocTitle">{block.text}</h2>;
  if (block.kind === "heading") {
    return block.level === 2
      ? <h3 className="ocrDocHeading">{block.text}</h3>
      : <h4 className="ocrDocSubheading">{block.text}</h4>;
  }
  if (block.kind === "article") return <h3 className="ocrDocArticle">{block.text}</h3>;
  if (block.kind === "note") return <aside className="ocrDocNote">{block.text}</aside>;
  if (block.kind === "checkbox") {
    return (
      <div className="ocrDocCheckbox">
        <span aria-hidden="true">{block.checked ? "☑" : "☐"}</span>
        <p>{block.text}</p>
      </div>
    );
  }
  if (block.kind === "field") {
    return (
      <div className="ocrDocField">
        <span>{block.label}</span>
        <i aria-hidden="true" />
        {block.value ? <strong>{block.value}</strong> : null}
      </div>
    );
  }
  if (block.kind === "list") {
    return (
      <div className="ocrDocList">
        <strong>{block.marker}</strong>
        <p>{block.text}</p>
      </div>
    );
  }
  if (block.kind === "table") return <TableBlock block={block} />;
  return <p className="ocrDocParagraph">{block.text}</p>;
}

function FormattedPreview({ pages }: { pages: PageResult[] }) {
  return (
    <section className="ocrFormattedPreview">
      <header>
        <div>
          <span>Bản trình bày thử nghiệm</span>
          <h2>Biểu mẫu, bảng và nội dung pháp luật</h2>
        </div>
        <small>Chỉ dùng để kiểm tra giao diện trước khi merge</small>
      </header>
      <div className="ocrPaperStack">
        {pages.map((page) => (
          <article className="ocrPaperPage" key={page.page}>
            <div className="ocrPaperNumber">Trang {page.page} · {passLabel(page.chosenPass)}</div>
            <div className="ocrPaperContent">
              {page.text
                ? buildOcrPreviewBlocks(page.text).map((block, index) => (
                    <PreviewBlock block={block} key={`${page.page}-${index}`} />
                  ))
                : <p className="ocrEmptyPage">Không tìm thấy nội dung chữ đủ tin cậy trên trang này.</p>}
            </div>
            {page.notices?.length ? (
              <details className="ocrPageNotices">
                <summary>Chi tiết xử lý trang {page.page}</summary>
                {page.notices.map((notice) => <p key={notice}>{notice}</p>)}
              </details>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

export default function OcrLabClient() {
  const [url, setUrl] = useState("");
  const [pageMode, setPageMode] = useState("3");
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
      body: JSON.stringify({ url, ...options }),
    });
    const payload = (await response.json().catch(() => ({}))) as LabResult & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Không thể chạy OCR thử nghiệm.");
    return payload;
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

      const totalPages = first.totalPages;
      for (let start = 3; start <= totalPages; start += 2) {
        const pages = [start, start + 1].filter((page) => page <= totalPages);
        setProgress(`Đang phân tích trang ${pages.join("–")}/${totalPages}…`);
        try {
          batches.push(await requestBatch(controller, { pages }));
        } catch (batchError) {
          if (controller.signal.aborted) throw batchError;
          if (pages.length === 1) throw batchError;
          for (const page of pages) {
            setProgress(`Đang thử lại riêng trang ${page}/${totalPages}…`);
            batches.push(await requestBatch(controller, { pages: [page] }));
          }
        }
        setResult(mergeResults(batches));
      }
      setProgress(`Đã hoàn tất toàn bộ ${totalPages} trang.`);
    } catch (requestError) {
      setError(
        controller.signal.aborted
          ? "Đã dừng quá trình phân tích toàn tệp. Các trang hoàn tất trước đó vẫn được giữ trên màn hình."
          : requestError instanceof Error ? requestError.message : "Không thể chạy OCR thử nghiệm.",
      );
    } finally {
      controllerRef.current = null;
      setLoading(false);
    }
  }

  function chooseSample(sampleUrl: string) {
    setUrl(sampleUrl);
    setError("");
    setProgress("");
    setResult(null);
  }

  return (
    <>
      <section className="ocrSamples">
        <header>
          <div>
            <span>Bộ mẫu kiểm thử chính thức</span>
            <h2>PDF lấy trực tiếp từ Văn bản Chính phủ</h2>
          </div>
          <small>Chạm một mẫu để điền đường dẫn; sau đó chọn số trang hoặc toàn bộ tệp.</small>
        </header>
        <div className="ocrSampleGrid">
          {OCR_SAMPLES.map((sample) => (
            <button
              type="button"
              key={sample.url}
              onClick={() => chooseSample(sample.url)}
              className={url === sample.url ? "isSelected" : ""}
              disabled={loading}
            >
              <strong>{sample.label}</strong>
              <span>{sample.description}</span>
            </button>
          ))}
        </div>
      </section>

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
          <span>Phạm vi thử</span>
          <select value={pageMode} onChange={(event) => setPageMode(event.target.value)} disabled={loading}>
            {[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value} trang đầu</option>)}
            <option value="full">Toàn bộ tệp</option>
          </select>
        </label>
        <div className="ocrFormActions">
          <button type="submit" disabled={loading}>{loading ? "Đang xử lý…" : "Chạy thử OCR"}</button>
          {loading ? <button className="ocrCancelButton" type="button" onClick={() => controllerRef.current?.abort()}>Dừng</button> : null}
        </div>
      </form>

      {pageMode === "full" ? (
        <p className="ocrFullHint">Chế độ toàn tệp chia PDF thành từng đợt 1–2 trang để tránh timeout. Trang có lớp chữ tốt được giữ nguyên; OCR chỉ tập trung vào trang scan hoặc trang có lớp chữ kém.</p>
      ) : null}
      {progress ? <p className="ocrProgress" role="status">{progress}</p> : null}
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
              <span>Kết quả sau xử lý</span>
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

          <FormattedPreview pages={result.ocr.pages} />

          <div className="ocrComparison">
            <article>
              <header><h2>Lớp chữ PDF hiện tại</h2><span>{scoreLabel(result.embedded.score)}</span></header>
              <pre>{result.embedded.text || "PDF không có lớp chữ đủ dùng."}</pre>
            </article>
            <article>
              <header><h2>Kết quả sau OCR và đối chiếu</h2><span>{scoreLabel(result.ocr.score)}</span></header>
              <pre>{result.ocr.text || "Không tìm thấy nội dung chữ đủ tin cậy."}</pre>
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
