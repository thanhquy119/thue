import assert from "node:assert/strict";
import test from "node:test";
import { buildOcrPreviewPages } from "../lib/legal/ocr-page-layout.ts";

function firstTable(page: ReturnType<typeof buildOcrPreviewPages>[number]) {
  const table = page.blocks.find((block) => block.kind === "table");
  assert.ok(table?.kind === "table");
  return table as typeof table & { continued?: boolean; notices?: string[] };
}

test("marks a repeated header on the next page as a continued table", () => {
  const pages = buildOcrPreviewPages([
    {
      page: 12,
      text: `
| STT | Nội dung tiêu chí | Đạt | Không đạt |
| :--- | :--- | :--- | :--- |
| 1 | Tiêu chí một | □ | □ |
`,
    },
    {
      page: 13,
      text: `
| STT | Nội dung tiêu chí | Đạt | Không đạt |
| :--- | :--- | :--- | :--- |
| 2 | Tiêu chí hai | ☑ | □ |
`,
    },
  ]);
  const table = firstTable(pages[1]!);
  assert.equal(table.continued, true);
  assert.equal(table.headerRows, 1);
  assert.deepEqual(table.rows[1], ["2", "Tiêu chí hai", "☑", "□"]);
  assert.ok(table.notices?.some((notice) => notice.includes("lặp lại hàng tiêu đề")));
});

test("merges a numbered row cut across two pages without duplicating the row", () => {
  const pages = buildOcrPreviewPages([
    {
      page: 20,
      text: `
| STT | Nội dung tiêu chí | Đạt | Không đạt |
| :--- | :--- | :--- | :--- |
| 1 | Tiêu chí một | □ | □ |
| 2 | Nội dung bị cắt ở cuối trang |
`,
    },
    {
      page: 21,
      text: `
| 2 | và được nối ở đầu trang sau | ☑ | □ |
| 3 | Tiêu chí ba | □ | ☑ |
`,
    },
  ]);
  const previous = firstTable(pages[0]!);
  const current = firstTable(pages[1]!);
  const rowTwo = previous.rows.find((row) => row[0] === "2");
  assert.match(rowTwo?.[1] ?? "", /cuối trang và được nối ở đầu trang sau/u);
  assert.equal(rowTwo?.[2], "☑");
  assert.equal(current.rows.filter((row) => row[0] === "2").length, 0);
  assert.deepEqual(current.rows[1]?.slice(0, 4), ["3", "Tiêu chí ba", "□", "☑"]);
});

test("never carries table schema across non-consecutive selected pages", () => {
  const pages = buildOcrPreviewPages([
    {
      page: 2,
      text: `
| STT | Nội dung tiêu chí | Đạt | Không đạt |
| :--- | :--- | :--- | :--- |
| 1 | Tiêu chí một | □ | □ |
`,
    },
    {
      page: 9,
      text: `
| 2 | Đây là một bảng độc lập ở trang khác | □ | □ |
`,
    },
  ]);
  const table = firstTable(pages[1]!);
  assert.equal(table.continued, undefined);
});
