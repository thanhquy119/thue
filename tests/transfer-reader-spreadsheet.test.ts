import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "@e965/xlsx";
import { extractTransferredFile } from "../lib/transfer/extraction.ts";
import { splitTransferredReaderItems } from "../lib/transfer/reader-structure.ts";
import {
  TRANSFER_TABLE_CELL_MARKER,
  TRANSFER_TABLE_START_MARKER,
} from "../lib/transfer/structured-text.ts";

test("transferred legal text is grouped into preamble and individual articles", () => {
  const items = splitTransferredReaderItems(`
BỘ TÀI CHÍNH
CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM

Điều 1. Phạm vi điều chỉnh
1. Văn bản này quy định việc thử nghiệm.
2. Áp dụng cho tổ chức, cá nhân liên quan.

Điều 2
Đối tượng áp dụng
1. Cơ quan thuế.
2. Người nộp thuế.
  `);

  assert.equal(items.length, 3);
  assert.equal(items[0].title, "Phần mở đầu");
  assert.equal(items[1].title, "Điều 1 — Phạm vi điều chỉnh");
  assert.equal(items[2].title, "Điều 2 — Đối tượng áp dụng");
  assert.match(items[1].blocks.map((block) => block.text).join(" "), /Văn bản này quy định/u);
  assert.match(items[2].blocks.map((block) => block.text).join(" "), /Người nộp thuế/u);
});

test("ordinary transferred content keeps a single readable section", () => {
  const items = splitTransferredReaderItems("Dòng thứ nhất.\n\nDòng thứ hai.", "Nội dung bảng tính");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Nội dung bảng tính");
  assert.equal(items[0].blocks.length, 2);
});

test("TSV transfer becomes a structured spreadsheet table", async () => {
  const extracted = await extractTransferredFile(
    Buffer.from("Tên\tSố tiền\nAn\t120000\nBình\t250000", "utf8"),
    "bao-cao.tsv",
    "text/tab-separated-values",
  );

  assert.equal(extracted.method, "spreadsheet");
  assert.equal(extracted.partial, false);
  assert.match(extracted.text, /Trang tính:/u);
  assert.match(extracted.text, /An/u);
  assert.match(extracted.text, /250000/u);
  assert.match(extracted.text, new RegExp(TRANSFER_TABLE_START_MARKER, "u"));
  assert.match(extracted.text, new RegExp(TRANSFER_TABLE_CELL_MARKER, "u"));
});

test("XLSX transfer preserves sheet names and cell values", async () => {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Khoản mục", "Giá trị"],
    ["Doanh thu", 1_500_000],
    ["Thuế", 75_000],
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Tháng 7");
  const output = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const extracted = await extractTransferredFile(
    Buffer.from(output),
    "bao-cao.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );

  assert.equal(extracted.method, "spreadsheet");
  assert.equal(extracted.partial, false);
  assert.equal(extracted.totalPages, 1);
  assert.match(extracted.text, /Trang tính: Tháng 7/u);
  assert.match(extracted.text, /Doanh thu/u);
  assert.match(extracted.text, /1500000/u);
});
