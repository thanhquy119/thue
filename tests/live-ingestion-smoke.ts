import assert from "node:assert/strict";
import { extractDurableLegalSource } from "../lib/legal/durable-extraction.ts";
import { validateDurableLegalText } from "../lib/legal/durable-ingestion-types.ts";
import { runOcrBatch } from "../lib/legal/ocr-batch-runner.ts";

const COMMIT_MARKER = "[live-ingestion]";
const enabled = process.env.RUN_LIVE_INGESTION_SMOKE === "true" ||
  (process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "").includes(COMMIT_MARKER);

const SOURCE_82_PAGE = "https://congbao.chinhphu.vn/van-ban/thong-tu-so-82-2026-tt-btc-469980.htm";
const SOURCE_82_DOCX = "https://g7.cdnchinhphu.vn/api/download/stream?Url=tm-8mq6BhNw0NbrKRhTDAaHMpvrqWaeHuYm7lW3HNfzTzww8Myg35dDL_fJB4izwcrTDu0YFNB0oewruvuJH6CpZLMUDikkjHrWRdNTOfZaDpbfU9tNzv9s2iDtBJ8gu7hz1Jr40GQATzj5tQsdyxg~~&file_name=2026_408_82%2F2026%2FTT-BTC.docx";
const SOURCE_82_PDF = "https://g7.cdnchinhphu.vn/api/download/stream?Url=tm-8mq6BhNw0NbrKRhTDAaHMpvrqWaeHuYm7lW3HNfzTzww8Myg35dDL_fJB4izwcrTDu0YFNB0oewruvuJH6HaaPB90cyRXH8FS696-j66K9wG4M6bEvAkV7haDddE9WPBirhZBHj1QhN57If-e4g~~&file_name=2026_408_82%2F2026%2FTT-BTC.pdf";
const SOURCE_94_PDF = "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/7/94-btc.pdf";

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("vi");
}

async function retry<T>(label: string, operation: () => Promise<T>, attempts = 2) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.warn(`[live-ingestion-retry] ${label} attempt=${attempt}`, error);
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }
  throw lastError;
}

function sourceSummary(source: Awaited<ReturnType<typeof extractDurableLegalSource>>) {
  return {
    sourceUrl: source.sourceUrl,
    fileName: source.fileName,
    mimeType: source.mimeType,
    bytes: source.sourceBuffer.byteLength,
    sha256: source.sha256,
    extractionMethod: source.extractionMethod,
    requiresOcr: source.requiresOcr,
    totalPages: source.totalPages,
    characters: source.officialText.length,
    qualityScore: source.qualityScore,
    metadata: source.metadata,
  };
}

async function main() {
  if (!enabled) {
    console.log(`[live-ingestion] skipped; add ${COMMIT_MARKER} to the commit message or set RUN_LIVE_INGESTION_SMOKE=true.`);
    return;
  }

  process.env.LEGAL_MAX_SOURCE_BYTES ||= "100000000";
  console.log("[live-ingestion] starting official-source matrix");

  const landing = await retry("82 landing page", () => extractDurableLegalSource(SOURCE_82_PAGE));
  assert.equal(landing.extractionMethod, "docx", "The official 82 landing page must resolve its preferred DOCX attachment.");
  assert.ok(landing.officialText.length > 5_000, "The 82 DOCX extracted from the landing page is unexpectedly short.");
  assert.ok(normalized(landing.officialText.slice(0, 30_000)).includes(normalized("82/2026/TT-BTC")));
  console.log("[live-ingestion-case]", JSON.stringify({ case: "82_html_to_docx", ...sourceSummary(landing) }));

  const directDocx = await retry("82 direct DOCX", () => extractDurableLegalSource(SOURCE_82_DOCX));
  assert.equal(directDocx.extractionMethod, "docx");
  assert.equal(directDocx.sha256, landing.sha256, "Landing-page and direct DOCX downloads should fingerprint identically.");
  console.log("[live-ingestion-case]", JSON.stringify({ case: "82_direct_docx", ...sourceSummary(directDocx) }));

  const directPdf = await retry("82 direct PDF", () => extractDurableLegalSource(SOURCE_82_PDF));
  assert.ok(directPdf.sourceBuffer.subarray(0, 5).toString("ascii") === "%PDF-");
  assert.ok(directPdf.totalPages > 0);
  assert.ok(["pdf_text", "ocr_required"].includes(directPdf.extractionMethod));
  console.log("[live-ingestion-case]", JSON.stringify({ case: "82_direct_pdf", ...sourceSummary(directPdf) }));

  const scanned = await retry("94 scan detection", () => extractDurableLegalSource(SOURCE_94_PDF));
  assert.ok(scanned.sourceBuffer.subarray(0, 5).toString("ascii") === "%PDF-");
  assert.ok(scanned.sourceBuffer.byteLength > 10_000_000, "The official 94 scan should exercise the large-file path.");
  assert.ok(scanned.totalPages >= 3);
  assert.equal(scanned.requiresOcr, true, "The official 94 PDF should be classified as requiring OCR.");
  assert.equal(scanned.extractionMethod, "ocr_required");
  console.log("[live-ingestion-case]", JSON.stringify({ case: "94_scan_detection", ...sourceSummary(scanned) }));

  const sampledPages = Array.from(new Set([
    1,
    Math.max(2, Math.ceil(scanned.totalPages / 2)),
    scanned.totalPages,
  ])).slice(0, 3);
  const ocr = await retry(
    "94 sampled OCR batch",
    () => runOcrBatch(SOURCE_94_PDF, { pages: sampledPages }),
    2,
  );
  assert.equal(ocr.processedPages, sampledPages.length);
  assert.equal(ocr.ocr.pages.length, sampledPages.length);
  assert.ok(ocr.ocr.pages.every((page) => page.text.trim().length > 40), "Every sampled page must yield non-empty OCR text.");
  assert.ok(
    normalized(ocr.ocr.pages[0]?.text ?? "").includes(normalized("94/2026/TT-BTC")),
    "The first OCR page must preserve the document number.",
  );

  const validation = validateDurableLegalText({
    expectedNumber: "94/2026/TT-BTC",
    issuedDate: "2026-07-01",
    text: ocr.ocr.text,
    extractionMethod: "ocr",
    qualityScore: ocr.ocr.score,
    totalPages: scanned.totalPages,
    pages: ocr.ocr.pages.map((page) => ({
      page: page.page,
      text: page.text,
      score: page.chosenScore,
      similarity: page.similarity,
      chosenPass: page.chosenPass,
      notices: page.notices ?? [],
    })),
  });
  assert.equal(validation.accepted, false, "A sampled OCR batch must never be publishable as the full document.");
  assert.match(validation.warnings.join(" "), /Thiếu nội dung đạt yêu cầu ở trang/iu);
  console.log("[live-ingestion-case]", JSON.stringify({
    case: "94_sampled_ocr",
    sampledPages,
    totalPages: scanned.totalPages,
    embeddedScore: ocr.embedded.score,
    ocrScore: ocr.ocr.score,
    recommendation: ocr.recommendation,
    pages: ocr.ocr.pages.map((page) => ({
      page: page.page,
      characters: page.text.length,
      chosenPass: page.chosenPass,
      chosenScore: page.chosenScore,
      similarity: page.similarity,
      notices: page.notices ?? [],
    })),
    validation,
  }));

  console.log("[live-ingestion] official-source matrix passed");
}

main().catch((error) => {
  console.error("[live-ingestion] failed", error);
  process.exitCode = 1;
});
