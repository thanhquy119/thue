import assert from "node:assert/strict";
import test from "node:test";
import { splitLegalBlocks } from "../lib/legal/format.ts";
import { parseLegalHierarchy } from "../lib/legal/ingestion.ts";

test("article heading is not duplicated inside official text", () => {
  const provisions = parseLegalHierarchy(`Điều 1. Phạm vi điều chỉnh\nLuật này quy định việc quản lý các loại thuế.\n\nĐiều 2. Đối tượng áp dụng\n1. Người nộp thuế.\n2. Cơ quan quản lý thuế.`);
  assert.equal(provisions.length, 2);
  assert.equal(provisions[0].identifier, "Điều 1");
  assert.equal(provisions[0].heading, "Phạm vi điều chỉnh");
  assert.equal(provisions[0].officialText, "Luật này quy định việc quản lý các loại thuế.");
  assert.equal(provisions[1].officialText.includes("Điều 2"), false);
});

test("isolated clause and point markers are joined with their content", () => {
  const blocks = splitLegalBlocks(`1.\nd) Tổ chức, cá nhân thực hiện khấu trừ, nộp thay số thuế.\n\n2.\nCơ quan quản lý thuế bao gồm cơ quan thuế và cơ quan hải quan.`);
  assert.deepEqual(blocks.map((block) => block.text), [
    "1. d) Tổ chức, cá nhân thực hiện khấu trừ, nộp thay số thuế.",
    "2. Cơ quan quản lý thuế bao gồm cơ quan thuế và cơ quan hải quan.",
  ]);
});
