import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transferOcrLeasePath } from "../lib/transfer/core.ts";
import {
  TRANSFER_OCR_STALE_PROCESSING_MS,
  transferOcrNeedsRun,
  transferOcrRetryPending,
  type TransferOcrScheduleFile,
} from "../lib/transfer/ocr-scheduling.ts";

const NOW = Date.parse("2026-07-30T09:00:00.000Z");

function pdfFile(overrides: Partial<TransferOcrScheduleFile> = {}): TransferOcrScheduleFile {
  return {
    name: "scan.pdf",
    contentType: "application/pdf",
    updatedAt: new Date(NOW).toISOString(),
    status: "ocr_partial",
    extractionMethod: "pdf_ocr",
    totalPages: 35,
    processedPages: 0,
    error: null,
    nextOcrAttemptAt: null,
    ...overrides,
  };
}

test("starts a queued PDF OCR batch but respects retry cooldown", () => {
  assert.equal(transferOcrNeedsRun(pdfFile(), NOW), true);
  assert.equal(transferOcrRetryPending(new Date(NOW + 60_000).toISOString(), NOW), true);
  assert.equal(transferOcrNeedsRun(pdfFile({ nextOcrAttemptAt: new Date(NOW + 60_000).toISOString() }), NOW), false);
});

test("does not POST repeatedly while another OCR invocation has a fresh heartbeat", () => {
  assert.equal(transferOcrNeedsRun(pdfFile({ status: "processing" }), NOW + 4_000), false);
  assert.equal(
    transferOcrNeedsRun(
      pdfFile({ status: "processing" }),
      NOW + TRANSFER_OCR_STALE_PROCESSING_MS,
    ),
    true,
  );
});

test("retries transient failures but not completed or non-PDF files", () => {
  assert.equal(transferOcrNeedsRun(pdfFile({ status: "failed", error: "OCR trang 1/35 quá thời gian." }), NOW), true);
  assert.equal(transferOcrNeedsRun(pdfFile({ status: "ready", processedPages: 35 }), NOW), false);
  assert.equal(transferOcrNeedsRun(pdfFile({ name: "bang.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), NOW), false);
});

test("uses a reusable R2 OCR lease instead of the tombstoned legacy path", () => {
  const store = readFileSync(new URL("../lib/transfer/store.ts", import.meta.url), "utf8");
  const releaseStart = store.indexOf("async function releaseOcrLease");
  const releaseEnd = store.indexOf("\n}\n", releaseStart);
  const releaseSource = releaseStart >= 0 && releaseEnd > releaseStart
    ? store.slice(releaseStart, releaseEnd + 3)
    : "";
  assert.equal(
    transferOcrLeasePath("a".repeat(64)),
    "transfers/ocr-global-lease-v2.json",
  );
  assert.match(store, /export function expireOcrLeaseRecord/u);
  assert.match(store, /expiresAt: new Date\(0\)\.toISOString\(\)/u);
  assert.match(store, /await writeJson\(pathname, expireOcrLeaseRecord\(lease\)\)/u);
  assert.ok(releaseSource);
  assert.doesNotMatch(releaseSource, /await del\(pathname\)/u);
});
