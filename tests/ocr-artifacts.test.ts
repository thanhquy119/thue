import assert from "node:assert/strict";
import test from "node:test";
import { cleanVisualArtifacts, hasVisualArtifactHints } from "../lib/legal/ocr-artifacts.ts";

test("removes digital certification metadata, page numbers and logo tokens", () => {
  const result = cleanVisualArtifacts(`SAO Y; Bộ Khoa học và Công nghệ; 02/04/2026; 17:08:02; +07:00
5. NỘI DUNG HÓA ĐƠN LOGO
Nội dung pháp lý cần giữ.
21`);

  assert.equal(result.text.includes("SAO Y"), false);
  assert.equal(result.text.includes("LOGO"), false);
  assert.equal(result.text.includes("\n21"), false);
  assert.equal(result.text.includes("5. NỘI DUNG HÓA ĐƠN"), true);
  assert.equal(result.text.includes("Nội dung pháp lý cần giữ."), true);
  assert.ok(result.removedLines >= 2);
});

test("preserves substantive legal notes and checkbox content", () => {
  const result = cleanVisualArtifacts(`Ghi chú:
4 Lựa chọn một (01) trong các trường hợp
☐ Trách nhiệm của người bán hàng hóa, cung cấp dịch vụ
Bổ sung quy định chuyển dữ liệu hóa đơn điện tử.`);

  assert.equal(result.text.includes("Ghi chú:"), true);
  assert.equal(result.text.includes("Lựa chọn một (01)"), true);
  assert.equal(result.text.includes("Trách nhiệm của người bán"), true);
});

test("detects pages needing artifact-aware OCR", () => {
  assert.equal(hasVisualArtifactHints("7. Trách nhiệm người bán LOGO Điều 15"), true);
  assert.equal(hasVisualArtifactHints("Điều 1. Phạm vi điều chỉnh"), false);
});
