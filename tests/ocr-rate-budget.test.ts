import assert from "node:assert/strict";
import test from "node:test";
import {
  OCR_CONCURRENCY,
  OCR_PAGES_PER_RUN,
  OCR_REQUEST_INTERVAL_MS,
} from "../lib/transfer/pdf-ocr.ts";

test("default OCR pacing keeps a wide margin below the 15 RPM free-tier ceiling", () => {
  const maximumStartsPerMinute = 60_000 / OCR_REQUEST_INTERVAL_MS;
  assert.ok(maximumStartsPerMinute < 9);
  assert.ok(maximumStartsPerMinute < 15 * 0.6);
  assert.equal(OCR_CONCURRENCY, 3);
  assert.equal(OCR_PAGES_PER_RUN, 6);
});
