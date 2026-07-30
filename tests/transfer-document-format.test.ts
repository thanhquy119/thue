import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyTransferDocumentBlocks } from "../lib/transfer/document-semantics.ts";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("transfer reader wires semantic formatting for appendices and closing blocks", () => {
  const layout = source("../app/transfer/layout.tsx");
  const enhancer = source("../app/transfer/document-format-enhancer.tsx");
  const styles = source("../app/transfer/document-format.css");

  assert.match(layout, /DocumentFormatEnhancer/u);
  assert.match(layout, /document-format\.css/u);
  assert.match(enhancer, /classifyTransferDocumentBlocks/u);
  assert.match(enhancer, /transferSignerName/u);
  assert.match(styles, /\.transferAppendixTitle/u);
  assert.match(styles, /\.transferRecipients/u);
  assert.match(styles, /\.transferSignatureRole/u);
});

test("appendix title and attached-note lines are classified independently", () => {
  assert.deepEqual(classifyTransferDocumentBlocks([
    "Phụ lục II",
    "TIÊU CHÍ PHÂN LOẠI MỨC ĐỘ RỦI RO ĐỐI VỚI NGƯỜI NỘP THUẾ",
    "(kèm theo Thông tư số 94/2026/TT-BTC ngày 01 tháng 7 năm 2026)",
    "Nội dung thông thường",
  ]), ["appendix-title", "appendix-note", "appendix-note", "normal"]);
});

test("recipient and signing blocks are recognized across common administrative forms", () => {
  assert.deepEqual(classifyTransferDocumentBlocks([
    "Nơi nhận: - Ban Bí thư; - Thủ tướng Chính phủ; - Lưu: VT.",
    "KT. BỘ TRƯỞNG THỨ TRƯỞNG",
    "Cao Anh Tuấn",
  ]), ["recipients", "signature-role", "signer-name"]);

  assert.deepEqual(classifyTransferDocumentBlocks([
    "Kính gửi: Cục Thuế các tỉnh, thành phố",
    "THỪA LỆNH BỘ TRƯỞNG",
    "Nguyễn Văn An",
  ]), ["recipients", "signature-role", "signer-name"]);
});

test("table formatter preserves explicit columns and only merges structural blank cells", () => {
  const enhancer = source("../app/transfer/table-format-enhancer.tsx");
  const styles = source("../app/transfer/transfer-table-format.css");

  assert.match(enhancer, /placeRowCells/u);
  assert.match(enhancer, /cell\.style\.gridColumn = String\(columnIndex \+ 1\)/u);
  assert.match(enhancer, /transferStructuredMergedCell/u);
  assert.match(enhancer, /columnCount >= 7 && columnIndex === 0/u);
  assert.match(styles, /transferStructuredCell\[hidden\]/u);
  assert.match(styles, /width:\s*max\(100%, var\(--transfer-table-min-width/u);
});
