import assert from "node:assert/strict";
import test from "node:test";
import { ingestionLoadingEstimate, type IngestionProgress } from "../lib/legal/ingestion-loading.ts";

const progress: IngestionProgress = { number: "109/2026/TT-BTC", status: "processing", processedPages: 0, totalPages: 17, updatedAt: "2026-10-11T04:00:00Z" };

test("estimate scales with remaining OCR pages and includes retry uncertainty", () => {
  assert.match(ingestionLoadingEstimate(progress), /2–7 phút/u);
  assert.match(ingestionLoadingEstimate({ ...progress, processedPages: 15 }), /1–2 phút/u);
  assert.match(ingestionLoadingEstimate({ ...progress, processedPages: 17 }), /1–2 phút/u);
  assert.match(ingestionLoadingEstimate(progress), /quá tải/u);
});

test("unknown page count is an estimate while terminal states do not promise completion", () => {
  assert.match(ingestionLoadingEstimate({ ...progress, totalPages: 0 }), /2–5 phút/u);
  for (const status of ["failed", "needs_review"] as const) {
    assert.match(ingestionLoadingEstimate({ ...progress, status }), /chưa xác định/u);
    assert.doesNotMatch(ingestionLoadingEstimate({ ...progress, status }), /\d+–\d+ phút/u);
  }
});
