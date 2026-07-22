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
  assert.equal(table.columnCount, 2);
  assert.equal(table.headerRows, 0);
  assert.equal(table.firstColumn, "label");
  assert.equal(table.rows.length, 3);
  assert.deepEqual(table.rows[1], ["Mẫu số 02", "Thuyết minh công nghệ đề nghị thẩm định trong trường hợp đặc thù"]);
});

test("keeps all columns in a five-column council table", () => {
  const blocks = buildOcrPreviewBlocks(`
| STT | Họ và tên | Lĩnh vực chuyên môn/quản lý | Cơ quan công tác | Chức danh trong Hội đồng |
| :--- | :--- | :--- | :--- | :--- |
| 1 | | | | Chủ tịch |
| 2 | | | | Phó Chủ tịch |
| 3 | | | | Ủy viên |
`);
  const table = blocks.find((block) => block.kind === "table");
  assert.ok(table && table.kind === "table");
  assert.equal(table.columnCount, 5);
  assert.equal(table.headerRows, 1);
  assert.equal(table.firstColumn, "index");
  assert.deepEqual(table.rows[1], ["1", "", "", "", "Chủ tịch"]);
});

test("repairs a wrapped final header cell before a markdown separator", () => {
  const blocks = buildOcrPreviewBlocks(`
| STT | Nội dung tiêu chí | Đạt | Không đạt | Nhận xét/đánh giá (nêu rõ điểm mạnh/điểm chưa rõ) |
Yêu cầu giải trình/bổ sung (nếu có) | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Có phương án, quy trình công nghệ được mô tả rõ ràng □ □ |
| 2 | Có một hoặc một số yếu tố kỹ thuật để thực hiện phương án □ □ |
`);
  const table = blocks.find((block) => block.kind === "table");
  assert.ok(table && table.kind === "table");
  assert.equal(table.columnCount, 6);
  assert.equal(table.rows[0][5], "Yêu cầu giải trình/bổ sung (nếu có)");
  assert.equal(table.rows[1][2], "□");
  assert.equal(table.rows[1][3], "□");
});

test("merges repeated OCR fragments belonging to the same numbered row", () => {
  const blocks = buildOcrPreviewBlocks(`
| STT | Nội dung tiêu chí | Đạt | Không đạt |
| 1 | Có phương án, quy trình công nghệ, giải pháp kỹ thuật |
| 1 | được mô tả rõ ràng về nguyên lý hoạt động và cách thức vận hành | □ | □ |
| 2 | Có khả năng tạo ra sản phẩm, dịch vụ | □ | □ |
`);
  const table = blocks.find((block) => block.kind === "table");
  assert.ok(table && table.kind === "table");
  assert.equal(table.rows.length, 3);
  assert.equal(table.rows[1][0], "1");
  assert.match(table.rows[1][1], /giải pháp kỹ thuật được mô tả rõ ràng/u);
});

test("drops repeated dotted filler lines from legal forms", () => {
  const blocks = buildOcrPreviewBlocks(`
THÔNG BÁO
Về ......................................................................................
... ... ... ... ... ... ... ... ... ... ... ... ... ... ...
........................................................................................
Kính gửi: ...............................................................................
1. Dự toán kinh phí
`);
  const paragraphs = blocks.filter((block) => block.kind === "paragraph");
  assert.ok(!paragraphs.some((block) => /\.\.\.\s+\.\.\./u.test(block.text)));
  assert.ok(blocks.some((block) => block.kind === "field" && block.label === "Kính gửi:"));
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
