import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("scanned PDFs render and OCR every page with bounded concurrency", () => {
  const ocr = readFileSync(new URL("../lib/transfer/pdf-ocr.ts", import.meta.url), "utf8");
  const extraction = readFileSync(new URL("../lib/transfer/extraction.ts", import.meta.url), "utf8");
  assert.match(ocr, /const OCR_CONCURRENCY = 4/u);
  assert.match(ocr, /first: totalPages/u);
  assert.match(ocr, /pages\.length !== totalPages/u);
  assert.match(ocr, /processedPages: totalPages/u);
  assert.match(ocr, /truncated: false/u);
  assert.match(extraction, /processedPages !== ocr\.totalPages/u);
  assert.match(extraction, /partial: false/u);
  assert.doesNotMatch(extraction, /phiên bản đầu đã OCR/u);
});

test("partial PDFs are migrated and cannot open before full OCR completes", () => {
  const store = readFileSync(new URL("../lib/transfer/store.ts", import.meta.url), "utf8");
  const processRoute = readFileSync(new URL("../app/api/transfer/files/[fileId]/process/route.ts", import.meta.url), "utf8");
  const readRoute = readFileSync(new URL("../app/api/transfer/files/[fileId]/route.ts", import.meta.url), "utf8");
  const enhancer = readFileSync(new URL("../app/transfer/transfer-polish-enhancer.tsx", import.meta.url), "utf8");
  assert.match(store, /reprocessTransferredPdf/u);
  assert.match(store, /status: "processing"/u);
  assert.match(store, /processedPages !== extracted\.totalPages/u);
  assert.match(processRoute, /maxDuration = 300/u);
  assert.match(processRoute, /reprocessTransferredPdf/u);
  assert.match(readRoute, /file\.meta\.status !== "ready"/u);
  assert.match(readRoute, /status: 409/u);
  assert.match(enhancer, /needsFullPdfOcr/u);
  assert.match(enhancer, /\/process`/u);
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

test("requested technical copy is removed from the rendered transfer and notification UI", () => {
  const enhancer = readFileSync(new URL("../app/transfer/transfer-polish-enhancer.tsx", import.meta.url), "utf8");
  const cleanup = readFileSync(new URL("../app/copy-cleanup.css", import.meta.url), "utf8");
  const rootLayout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(enhancer, /Sẵn sàng đọc và nghe/u);
  assert.match(enhancer, /Trích từ Word cũ/u);
  assert.match(enhancer, /helper\.hidden = true/u);
  assert.match(cleanup, /notificationHistoryFooter > span/u);
  assert.match(cleanup, /display: none !important/u);
  assert.match(rootLayout, /copy-cleanup\.css/u);
});
