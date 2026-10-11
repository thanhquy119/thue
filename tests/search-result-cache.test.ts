import assert from "node:assert/strict";
import test from "node:test";
import { canCacheSearchResult } from "../lib/legal/search-result-cache.ts";
import type { TaxSearchResponse } from "../lib/legal/types.ts";

function result(): TaxSearchResponse {
  return {
    query_normalized: "109/2026/tt-btc",
    query_kind: "document",
    direct_answer: "Đã xử lý đủ 17/17 trang, nhưng chưa đạt chất lượng.",
    document: null,
    candidates: [],
    warnings: ["Có trang OCR chỉ đạt 47% chất lượng."],
    confidence: 0.76,
    retrieved_at: new Date().toISOString(),
  };
}

test("review and processing results must re-fetch rather than remain cached", () => {
  const response = result();
  assert.equal(canCacheSearchResult(response), false);
  assert.equal(canCacheSearchResult({ ...response, direct_answer: "Đang xử lý nền" }), false);
});

test("published full text can still use the session cache", () => {
  const response = result();
  // Only the official text field participates in the cache decision.
  const document = { official_text: "Toàn văn đã được kiểm tra." } as NonNullable<TaxSearchResponse["document"]>;
  assert.equal(canCacheSearchResult({ ...response, document }), true);
  assert.equal(canCacheSearchResult({ ...response, document: { ...document, official_text: "  " } }), false);
});
