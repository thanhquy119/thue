import assert from "node:assert/strict";
import test from "node:test";
import { buildOcrPreviewPages } from "../lib/legal/ocr-page-layout.ts";

function tables(page: ReturnType<typeof buildOcrPreviewPages>[number]) {
  return page.blocks.filter((block) => block.kind === "table");
}

test("restores a six-column criteria table on the following page", () => {
  const pages = buildOcrPreviewPages([
    {
      page: 12,
      text: `
II. NHẬN XÉT, ĐÁNH GIÁ THEO TIÊU CHÍ THẨM ĐỊNH
| STT | Nội dung tiêu chí | Đạt | Không đạt | Nhận xét/đánh giá | Yêu cầu giải trình/bổ sung |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Có phương án, quy trình công nghệ được mô tả rõ ràng | □ | □ | | |
| 2 | Có một hoặc một số yếu tố kỹ thuật để thực hiện phương án | □ | □ | | |
`,
    },
    {
      page: 13,
      text: `
nghệ, giải pháp kỹ thuật quy định tại khoản 1 Điều 12 Nghị định số 101/2026/NĐ-CP
| 3 | Có khả năng tạo ra sản phẩm, dịch vụ hoặc kết quả cụ thể □ □ |
| 4 | Không thuộc Danh mục công nghệ cấm chuyển giao □ □ |
| 5 | Đã được thử nghiệm, vận hành ngoài phạm vi phòng thí nghiệm □ □ |
`,
    },
  ]);

  const page12Table = tables(pages[0]!)[0];
  const page13Table = tables(pages[1]!)[0];
  assert.ok(page12Table?.kind === "table");
  assert.ok(page13Table?.kind === "table");
  assert.match(page12Table.rows[2]?.[1] ?? "", /Nghị định số 101\/2026\/NĐ-CP/u);
  assert.equal(page13Table.columnCount, 6);
  assert.equal(page13Table.headerRows, 1);
  assert.equal((page13Table as typeof page13Table & { continued?: boolean }).continued, true);
  assert.deepEqual(page13Table.rows[1]?.slice(0, 4), ["3", "Có khả năng tạo ra sản phẩm, dịch vụ hoặc kết quả cụ thể", "□", "□"]);
});

test("keeps an unknown second checkbox blank instead of guessing", () => {
  const pages = buildOcrPreviewPages([
    {
      page: 1,
      text: `
| STT | Nội dung tiêu chí | Đạt | Không đạt |
| :--- | :--- | :--- | :--- |
| 1 | Tiêu chí một | □ | □ |
`,
    },
    {
      page: 2,
      text: `
| 2 | Tiêu chí hai □ |
| 3 | Tiêu chí ba □ □ |
`,
    },
  ]);
  const table = tables(pages[1]!)[0];
  assert.ok(table?.kind === "table");
  assert.equal(table.rows[1]?.[2], "□");
  assert.equal(table.rows[1]?.[3], "");
  const notices = (table as typeof table & { notices?: string[] }).notices ?? [];
  assert.ok(notices.some((notice) => notice.includes("để trống để tránh suy đoán")));
});

test("merges adjacent OCR bands belonging to one table", () => {
  const pages = buildOcrPreviewPages([
    {
      page: 7,
      text: `
| STT | Nội dung tiêu chí | Đạt | Không đạt |
| :--- | :--- | :--- | :--- |
| 1 | Tiêu chí một | □ | □ |
| 2 | Tiêu chí hai | □ | □ |

| 3 | Tiêu chí ba □ □ |
| 4 | Tiêu chí bốn □ □ |
`,
    },
  ]);
  const tableBlocks = tables(pages[0]!);
  assert.equal(tableBlocks.length, 1);
  const table = tableBlocks[0];
  assert.ok(table?.kind === "table");
  assert.equal(table.rows.length, 5);
  assert.deepEqual(table.rows[3]?.slice(0, 4), ["3", "Tiêu chí ba", "□", "□"]);
});

test("does not merge unrelated numbered tables", () => {
  const pages = buildOcrPreviewPages([
    {
      page: 8,
      text: `
| STT | Nội dung tiêu chí |
| :--- | :--- |
| 1 | Bảng thứ nhất |

PHỤ LỤC KHÁC
| STT | Nội dung tiêu chí |
| :--- | :--- |
| 1 | Bảng thứ hai |
`,
    },
  ]);
  assert.equal(tables(pages[0]!).length, 2);
});
