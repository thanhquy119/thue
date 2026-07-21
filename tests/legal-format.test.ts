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

test("preamble is rebuilt from semantic anchors when header fields are merged", () => {
  const blocks = splitLegalBlocks(`CHÍNH PHỦ ______\nCỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nĐộc lập - Tự do - Hạnh phúc\nSố: 141/2026/NĐ-CP CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM Độc lập - Tự do - Hạnh phúc\nHà Nội, ngày 29 tháng 4 năm 2026\nNGHỊ ĐỊNH Sửa đổi, bổ sung một số điều của Nghị định số 68/2026/NĐ-CP của Chính phủ\nCăn cứ Luật Tổ chức Chính phủ số 63/2025/QH15; Căn cứ Luật Thuế thu nhập cá nhân số 109/2025/QH15; Theo đề nghị của Bộ trưởng Bộ Tài chính;`);

  assert.deepEqual(blocks.slice(0, 7).map((block) => block.kind), [
    "preamble-authority",
    "preamble-national",
    "preamble-motto",
    "preamble-number",
    "preamble-dateline",
    "preamble-type",
    "preamble-title",
  ]);
  assert.equal(blocks[0].text, "CHÍNH PHỦ");
  assert.equal(blocks[3].text, "Số: 141/2026/NĐ-CP");
  assert.match(blocks[6].text, /Nghị định số 68\/2026\/NĐ-CP của Chính phủ/u);
  assert.equal(blocks.filter((block) => block.text.startsWith("Căn cứ")).length, 2);
});

test("preamble ignores source labels and duplicate authority lines", () => {
  const blocks = splitLegalBlocks(`VĂN BẢN QUY PHẠM PHÁP LUẬT\nCHÍNH PHỦ\nCHÍNH PHỦ\nSố: 67/2025/NĐ-CP CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM Độc lập - Tự do - Hạnh phúc\nHà Nội, ngày 15 tháng 3 năm 2025\nNGHỊ ĐỊNH VỀ SỬA ĐỔI, BỔ SUNG MỘT SỐ ĐIỀU CỦA NGHỊ ĐỊNH SỐ 178/2024/NĐ-CP CỦA CHÍNH PHỦ\nCăn cứ Luật Tổ chức Chính phủ ngày 18 tháng 02 năm 2025; Theo đề nghị của Bộ trưởng Bộ Nội vụ;`);

  assert.equal(blocks[0].text, "CHÍNH PHỦ");
  assert.equal(blocks.some((block) => block.text.includes("VĂN BẢN QUY PHẠM PHÁP LUẬT")), false);
  assert.equal(blocks[5].text, "NGHỊ ĐỊNH");
  assert.match(blocks[6].text, /CỦA CHÍNH PHỦ/u);
});

test("document type uses the earliest header label instead of a cited type in the title", () => {
  const blocks = splitLegalBlocks(`BỘ TÀI CHÍNH\nCỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nĐộc lập - Tự do - Hạnh phúc\nSố: 89/2026/TT-BTC\nHà Nội, ngày 30 tháng 6 năm 2026\nTHÔNG TƯ\nQuy định chi tiết một số điều của Nghị định số 252/2026/NĐ-CP của Chính phủ\nCăn cứ Luật Quản lý thuế;`);

  assert.equal(blocks[0].text, "BỘ TÀI CHÍNH");
  assert.equal(blocks[5].text, "THÔNG TƯ");
  assert.match(blocks[6].text, /Nghị định số 252\/2026\/NĐ-CP/u);
});
