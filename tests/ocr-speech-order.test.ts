import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOcrSpeechQueue,
  findOcrSpeechUnitIndex,
  type OcrSpeechUnitData,
} from "../lib/legal/ocr-speech-order.ts";

const units: OcrSpeechUnitData[] = [
  { id: "preamble-heading", page: 1, texts: ["Phần mở đầu"] },
  { id: "preamble-entry-0", page: 1, texts: ["Chính phủ"] },
  { id: "article-1-heading", page: 2, texts: ["Điều 1. Phạm vi điều chỉnh"] },
  { id: "article-1-entry-0", page: 2, texts: ["Khoản một.", "Khoản một tiếp theo."] },
  { id: "table-row-0", page: 3, texts: ["Mục 1. Nội dung hàng bảng."] },
];

test("starts the queue exactly at the user-selected block and continues forward", () => {
  const start = findOcrSpeechUnitIndex(units, "article-1-entry-0");
  assert.equal(start, 3);
  const queue = buildOcrSpeechQueue(units, start);
  assert.deepEqual(queue.map((item) => item.unitId), [
    "article-1-entry-0",
    "article-1-entry-0",
    "table-row-0",
  ]);
  assert.deepEqual(queue.map((item) => item.text), [
    "Khoản một.",
    "Khoản một tiếp theo.",
    "Mục 1. Nội dung hàng bảng.",
  ]);
});

test("preserves source pages while reading continuously across page boundaries", () => {
  const queue = buildOcrSpeechQueue(units, 2);
  assert.deepEqual(queue.map((item) => item.page), [2, 2, 2, 3]);
  assert.deepEqual(queue.map((item) => item.unitIndex), [2, 3, 3, 4]);
});

test("clamps an invalid start index instead of returning a broken queue", () => {
  assert.equal(buildOcrSpeechQueue(units, -100)[0]?.unitId, "preamble-heading");
  assert.equal(buildOcrSpeechQueue(units, 100)[0]?.unitId, "table-row-0");
  assert.equal(findOcrSpeechUnitIndex(units, "missing"), -1);
});
