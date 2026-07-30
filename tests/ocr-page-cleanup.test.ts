import assert from "node:assert/strict";
import test from "node:test";
import { stripOcrPageMarkers } from "../lib/transfer/ocr-page-cleanup.ts";

test("removes common page-number markers only at page edges", () => {
  assert.equal(stripOcrPageMarkers("Trang 3/35\n\nTIÊU ĐỀ\nNội dung", 3), "TIÊU ĐỀ\nNội dung");
  assert.equal(stripOcrPageMarkers("Nội dung trang\n\n- 12 -", 12), "Nội dung trang");
  assert.equal(stripOcrPageMarkers("[8]\nNội dung trang", 8), "Nội dung trang");
  assert.equal(stripOcrPageMarkers("Nội dung trang\n7", 7), "Nội dung trang");
});

test("keeps legal numbering and numbers inside the document body", () => {
  const text = "1. Phạm vi điều chỉnh\nĐiều 12. Nội dung\n2026\nKết thúc";
  assert.equal(stripOcrPageMarkers(text, 4), text);
  assert.equal(stripOcrPageMarkers("1. Mục đầu tiên\nNội dung", 1), "1. Mục đầu tiên\nNội dung");
});
