import assert from "node:assert/strict";
import test from "node:test";
import { buildOcrPreviewBlocks } from "../lib/legal/ocr-layout.ts";

test("formats model tables as two-column legal tables", () => {
  const blocks = buildOcrPreviewBlocks(`
PHỤ LỤC
| Mẫu số 01 | Đơn đề nghị thẩm định công nghệ trong trường hợp đặc thù |
| Mẫu số 02 | Thuyết minh công nghệ đề nghị thẩm định trong trường hợp đặc thù |
| Mẫu số 03 | Thông báo dự toán kinh phí thẩm định công nghệ |
`);
  const table = blocks.find((block) => block.kind === "table");
  assert.ok(table && table.kind === "table");
  assert.equal(table.rows.length, 3);
  assert.deepEqual(table.rows[1], ["Mẫu số 02", "Thuyết minh công nghệ đề nghị thẩm định trong trường hợp đặc thù"]);
});

test("preserves form fields and checkboxes", () => {
  const blocks = buildOcrPreviewBlocks(`
I. THÔNG TIN TỔ CHỨC, CÁ NHÂN ĐỀ NGHỊ THẨM ĐỊNH
1. Tên tổ chức/cá nhân: ....................................................................
□ Công nghệ do tổ chức, cá nhân nghiên cứu tạo ra
☑ Công nghệ đã được lựa chọn
`);
  assert.ok(blocks.some((block) => block.kind === "heading"));
  assert.ok(blocks.some((block) => block.kind === "field" && block.label.includes("Tên tổ chức")));
  assert.ok(blocks.some((block) => block.kind === "checkbox" && block.checked === false));
  assert.ok(blocks.some((block) => block.kind === "checkbox" && block.checked === true));
});
