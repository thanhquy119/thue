import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("scanned PDFs use a sequential rate safely below fifteen requests per minute", () => {
  const ocr = readFileSync(new URL("../lib/transfer/pdf-ocr.ts", import.meta.url), "utf8");
  const extraction = readFileSync(new URL("../lib/transfer/extraction.ts", import.meta.url), "utf8");
  assert.match(ocr, /OCR_REQUEST_INTERVAL_MS = 8_000/u);
  assert.match(ocr, /OCR_PAGES_PER_RUN = 18/u);
  assert.match(ocr, /for \(let index = 0; index < pages\.length; index \+= 1\)/u);
  assert.match(ocr, /await wait\(Math\.max\(0, requestIntervalMs\(\) - elapsed\)\)/u);
  assert.doesNotMatch(ocr, /OCR_CONCURRENCY/u);
  assert.match(ocr, /first: endPage/u);
  assert.match(extraction, /deferPdfOcr/u);
  assert.match(extraction, /method: "pdf_ocr"[\s\S]*processedPages: 0[\s\S]*partial: true/u);
});

test("PDF OCR is checkpointed, serialized and cannot open before every page completes", () => {
  const store = readFileSync(new URL("../lib/transfer/store.ts", import.meta.url), "utf8");
  const processRoute = readFileSync(new URL("../app/api/transfer/files/[fileId]/process/route.ts", import.meta.url), "utf8");
  const readRoute = readFileSync(new URL("../app/api/transfer/files/[fileId]/route.ts", import.meta.url), "utf8");
  const enhancer = readFileSync(new URL("../app/transfer/transfer-polish-enhancer.tsx", import.meta.url), "utf8");
  assert.match(store, /transferOcrCheckpointPath/u);
  assert.match(store, /acquireOcrLease/u);
  assert.match(store, /OCR_CHECKPOINT_VERSION/u);
  assert.match(store, /status: "ocr_partial"/u);
  assert.match(store, /nextOcrAttemptAt/u);
  assert.match(processRoute, /maxDuration = 300/u);
  assert.match(processRoute, /status === "ocr_partial"/u);
  assert.match(readRoute, /file\.meta\.status !== "ready"/u);
  assert.match(readRoute, /status: 409/u);
  assert.match(enhancer, /const nextFile = files\.find\(needsFullPdfOcr\)/u);
  assert.match(enhancer, /processingRef = useRef<string \| null>\(null\)/u);
  assert.doesNotMatch(enhancer, /new Set<string>/u);
  assert.match(enhancer, /readyToOpen/u);
});

test("transferred legal text is justified and the administrative preamble stays aligned", () => {
  const styles = readFileSync(new URL("../app/transfer/reader-overrides.css", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../app/transfer/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /reader-overrides\.css/u);
  assert.match(styles, /preamble-authority[\s\S]*grid-column: 1 !important/u);
  assert.match(styles, /preamble-national[\s\S]*grid-column: 2 !important/u);
  assert.match(styles, /preamble-number[\s\S]*grid-row: 3 !important/u);
  assert.match(styles, /legalBlock\.paragraph[\s\S]*text-align: justify !important/u);
  assert.match(styles, /text-align-last: left !important/u);
  assert.match(styles, /\.uploadCard small[\s\S]*display: none !important/u);
});

test("technical extraction labels are removed from the rendered reader", () => {
  const enhancer = readFileSync(new URL("../app/transfer/transfer-polish-enhancer.tsx", import.meta.url), "utf8");
  const cleanup = readFileSync(new URL("../app/copy-cleanup.css", import.meta.url), "utf8");
  const rootLayout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(enhancer, /Trích từ Word cũ/u);
  assert.match(cleanup, /\.transferMethod[\s\S]*display: none !important/u);
  assert.match(cleanup, /notificationHistoryFooter > span/u);
  assert.match(rootLayout, /copy-cleanup\.css/u);
});
