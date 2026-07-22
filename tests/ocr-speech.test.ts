import assert from "node:assert/strict";
import test from "node:test";
import { cleanOcrSpeechText, formatOcrTableRow, splitOcrSpeechChunks } from "../lib/legal/ocr-speech.ts";

test("cleans OCR table markers and speaks checkbox states", () => {
  assert.equal(
    cleanOcrSpeechText("[TABLE]\n| 3 | Nội dung | ☑ | □ |\n[/TABLE]"),
    "3, Nội dung, ô đã đánh dấu, ô chưa đánh dấu,",
  );
});

test("splits long OCR text into bounded chunks", () => {
  const chunks = splitOcrSpeechChunks("Điều 1. " + "Nội dung kiểm thử ".repeat(40), 90);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 90));
  assert.match(chunks.join(" "), /Điều 1/u);
});

test("content mode reads the main table content and selected status", () => {
  const spoken = formatOcrTableRow(
    ["STT", "Nội dung tiêu chí", "Đạt", "Không đạt", "Nhận xét"],
    ["3", "Có khả năng tạo ra sản phẩm", "☑", "□", ""],
    "content",
  );
  assert.equal(spoken, "Mục 3. Có khả năng tạo ra sản phẩm. Đã chọn Đạt.");
});

test("verify mode explicitly reads empty cells", () => {
  const spoken = formatOcrTableRow(
    ["STT", "Nội dung", "Đạt", "Không đạt"],
    ["2", "Tiêu chí hai", "□", ""],
    "verify",
  );
  assert.match(spoken, /Đạt: chưa đánh dấu/u);
  assert.match(spoken, /Không đạt: để trống/u);
});
