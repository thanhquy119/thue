import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { splitTransferredReaderItems } from "../lib/transfer/reader-structure.ts";
import {
  structureTransferredTables,
  TRANSFER_TABLE_CELL_MARKER,
  TRANSFER_TABLE_ROW_MARKER,
  TRANSFER_TABLE_START_MARKER,
} from "../lib/transfer/structured-text.ts";

test("explicit OCR table markers become the internal row and cell structure", () => {
  const result = structureTransferredTables(`
Phụ lục tiêu chí
[[TABLE]]
STT | Nhóm tiêu chí | Tiêu chí
1 | Trạng thái hoạt động | Tình trạng hoạt động
2 | Chủ sở hữu | Số lần thay đổi
[[/TABLE]]
  `);

  assert.match(result, new RegExp(TRANSFER_TABLE_START_MARKER, "u"));
  assert.match(result, new RegExp(TRANSFER_TABLE_CELL_MARKER, "u"));
  assert.match(result, new RegExp(TRANSFER_TABLE_ROW_MARKER, "u"));
  assert.doesNotMatch(result, /\[\[\/?TABLE\]\]/u);
});

test("loose pipe tables and an OCR page number between continuations are reconstructed", () => {
  const result = structureTransferredTables(`
STT | Nhóm tiêu chí | Tiêu chí | (1) | (2)
1 | Trạng thái hoạt động | Tình trạng hoạt động | Số lần tạm ngừng | Số lần thay đổi
2
STT | Nhóm tiêu chí | Tiêu chí | 16 | 17
2 | Tình hình nợ thuế | Tổng số tiền nợ thuế | Biến động số nợ | Số lần cưỡng chế
  `);

  assert.match(result, new RegExp(TRANSFER_TABLE_START_MARKER, "u"));
  assert.doesNotMatch(result, /(?:^|\n)2(?:\n|$)/u);
  assert.ok((result.match(new RegExp(TRANSFER_TABLE_ROW_MARKER, "gu")) ?? []).length >= 4);
});

test("reader retrofits table structure for OCR text that was stored before this version", () => {
  const items = splitTransferredReaderItems(`
Điều 23. Hiệu lực thi hành
1. Thông tư có hiệu lực từ ngày 01 tháng 7 năm 2026.

STT | Nhóm tiêu chí | Tiêu chí
1 | Trạng thái hoạt động | Tình trạng hoạt động
  `);

  assert.equal(items.length, 1);
  assert.match(items[0].blocks.map((block) => block.text).join(" "), new RegExp(TRANSFER_TABLE_START_MARKER, "u"));
});

test("PWA copy and adaptive table renderer are wired into the transfer layout", () => {
  const layout = readFileSync(new URL("../app/transfer/layout.tsx", import.meta.url), "utf8");
  const pwa = readFileSync(new URL("../app/transfer/pwa-context-enhancer.tsx", import.meta.url), "utf8");
  const tableEnhancer = readFileSync(new URL("../app/transfer/table-format-enhancer.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../app/transfer/transfer-table-format.css", import.meta.url), "utf8");
  const ocr = readFileSync(new URL("../lib/transfer/pdf-ocr.ts", import.meta.url), "utf8");

  assert.match(layout, /PwaContextEnhancer/u);
  assert.match(layout, /TableFormatEnhancer/u);
  assert.match(pwa, /display-mode: standalone/u);
  assert.match(styles, /Gửi file sang máy tính/u);
  assert.match(tableEnhancer, /--transfer-table-template/u);
  assert.match(tableEnhancer, /transferStructuredStickyCell/u);
  assert.match(ocr, /\[\[TABLE\]\]/u);
  assert.match(ocr, /mỗi hàng của bảng phải nằm trên đúng một dòng/u);
});
