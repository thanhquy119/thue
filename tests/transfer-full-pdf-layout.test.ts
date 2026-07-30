import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("scanned PDFs use a globally serialized rate far below fifteen requests per minute", () => {
  const ocr = readFileSync(new URL("../lib/transfer/pdf-ocr.ts", import.meta.url), "utf8");
  const core = readFileSync(new URL("../lib/transfer/core.ts", import.meta.url), "utf8");
  const extraction = readFileSync(new URL("../lib/transfer/extraction.ts", import.meta.url), "utf8");
  assert.match(ocr, /OCR_REQUEST_INTERVAL_MS = 20_000/u);
  assert.match(ocr, /OCR_PAGES_PER_RUN = 5/u);
  assert.match(ocr, /DEFAULT_QUOTA_RETRY_MS = 180_000/u);
  assert.match(ocr, /let lastRequestStartedAt = startPage > 1 \? Date\.now\(\) : 0/u);
  assert.match(ocr, /await wait\(Math\.max\(0, requestIntervalMs\(\) - elapsed\)\)/u);
  assert.match(ocr, /Math\.max\(DEFAULT_QUOTA_RETRY_MS, headerDelay, messageDelay\)/u);
  assert.match(ocr, /const partial = Array\.from/u);
  assert.doesNotMatch(ocr, /first: endPage/u);
  assert.doesNotMatch(ocr, /OCR_CONCURRENCY/u);
  assert.match(core, /return "transfers\/ocr-global-lease\.json"/u);
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

test("transferred legal text is justified, split by article and navigable", () => {
  const page = readFileSync(new URL("../app/transfer/page.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../app/transfer/reader-overrides.css", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../app/transfer/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /reader-overrides\.css/u);
  assert.match(page, /splitTransferredReaderItems/u);
  assert.match(page, /transferProvisionNav/u);
  assert.match(page, /← Điều trước/u);
  assert.match(page, /Điều sau →/u);
  assert.match(page, /goToProvision\(currentProvisionIndex - 1, true\)/u);
  assert.match(styles, /preamble-authority[\s\S]*grid-column: 1 !important/u);
  assert.match(styles, /preamble-national[\s\S]*grid-column: 2 !important/u);
  assert.match(styles, /legalBlock\.paragraph[\s\S]*text-align: justify !important/u);
  assert.match(styles, /\.transferProvisionNav/u);
});

test("technical extraction labels are removed from the rendered reader", () => {
  const page = readFileSync(new URL("../app/transfer/page.tsx", import.meta.url), "utf8");
  const enhancer = readFileSync(new URL("../app/transfer/transfer-polish-enhancer.tsx", import.meta.url), "utf8");
  const cleanup = readFileSync(new URL("../app/copy-cleanup.css", import.meta.url), "utf8");
  const rootLayout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /Trích từ Word cũ/u);
  assert.doesNotMatch(page, /transferMethod/u);
  assert.doesNotMatch(enhancer, /Trích từ Word cũ/u);
  assert.match(cleanup, /notificationHistoryFooter > span/u);
  assert.match(rootLayout, /copy-cleanup\.css/u);
});
