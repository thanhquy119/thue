import assert from "node:assert/strict";
import test from "node:test";
import {
  durableOcrPageNeedsRetry,
  mergeDurableOcrPages,
  pendingDurableOcrPages,
} from "../lib/legal/durable-ocr-retry.ts";
import type { DurableOcrPage } from "../lib/legal/durable-ingestion-types.ts";

function page(number: number, score = 0.85, similarity = 0.96): DurableOcrPage {
  return {
    page: number,
    text: "Nội dung pháp luật được nhận dạng từ bản scan chính thức của trang này.",
    score,
    similarity,
    chosenPass: "consensus",
    notices: [],
  };
}

test("17/17 processed pages still retries only the page at 47% quality", () => {
  const requested = Array.from({ length: 17 }, (_, index) => index + 1);
  const pages = requested.map((number) => page(number, number === 17 ? 0.47 : 0.85));
  assert.deepEqual(pendingDurableOcrPages(requested, pages), [17]);
  const recovered = mergeDurableOcrPages(pages, [page(17, 0.8)]);
  assert.equal(recovered.length, 17);
  assert.deepEqual(pendingDurableOcrPages(requested, recovered), []);
});

test("retry keeps a better page when a later OCR attempt is empty or worse", () => {
  const original = page(2, 0.47);
  for (const retry of [page(2, 0.3), { ...page(2, 0), text: "" }, page(2, Number.NaN)]) {
    assert.deepEqual(mergeDurableOcrPages([original], [retry]), [original]);
  }
});

test("retry prefers passing comparison over a higher but divergent score", () => {
  const original = page(1, 0.9, 0.6);
  const recovered = page(1, 0.8, 0.95);
  assert.deepEqual(mergeDurableOcrPages([original], [recovered]), [recovered]);
  assert.deepEqual(mergeDurableOcrPages([recovered], [original]), [recovered]);
});

test("missing, short, non-finite and divergent pages remain pending", () => {
  const pages = [page(1), { ...page(2), text: "Chữ ngắn" }, page(3, Number.NaN), page(4, 0.9, 0.6)];
  assert.deepEqual(pendingDurableOcrPages([1, 2, 3, 4, 5], pages), [2, 3, 4, 5]);
  assert.equal(durableOcrPageNeedsRetry(page(6, 0.62, 0.72)), false);
  assert.equal(durableOcrPageNeedsRetry(page(7, 0.8, 0)), false);
});
