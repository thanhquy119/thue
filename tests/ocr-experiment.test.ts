import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanOcrTextForQuality,
  ocrTokenSimilarityForQuality,
  removeRepeatedPageEdgesForQuality,
  scoreLegalOcrTextForQuality,
  selectBestOcrDraftForQuality,
} from "../lib/legal/ocr-quality.ts";

test("clean OCR text removes wrappers but preserves legal content", () => {
  const cleaned = cleanOcrTextForQuality(`\`\`\`text\nKẾT QUẢ OCR:\nTRANG 1/2\nNGHỊ ĐỊNH\nĐiều 1. Phạm vi điều chỉnh\n\`\`\``);
  assert.equal(cleaned, "NGHỊ ĐỊNH\nĐiều 1. Phạm vi điều chỉnh");
});

test("legal OCR score rewards structured Vietnamese legal text", () => {
  const good = `CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nĐộc lập - Tự do - Hạnh phúc\nSố: 141/2026/NĐ-CP\nNGHỊ ĐỊNH\nCăn cứ Luật Tổ chức Chính phủ;\nĐiều 1. Sửa đổi, bổ sung một số điều.`;
  const bad = `C0NG H0A XA H0I CHU NGHIA VIET NAM □□ ???\nlJ 1 O0 5S\na b c d e`;
  assert.ok(scoreLegalOcrTextForQuality(good) > scoreLegalOcrTextForQuality(bad) + 0.25);
});

test("token similarity ignores Vietnamese accents and punctuation", () => {
  const similarity = ocrTokenSimilarityForQuality(
    "Điều 1. Người nộp thuế thực hiện khai thuế.",
    "Dieu 1 - Nguoi nop thue thuc hien khai thue",
  );
  assert.ok(similarity > 0.9);
});

test("best OCR draft prefers consensus when quality is effectively tied", () => {
  const selected = selectBestOcrDraftForQuality([
    { text: "Điều 1. Nội dung A", score: 0.81, pass: "literal" },
    { text: "Điều 1. Nội dung A", score: 0.812, pass: "consensus" },
  ]);
  assert.equal(selected.pass, "consensus");
});

test("repeated page edges are removed without removing legal headings", () => {
  const pages = removeRepeatedPageEdgesForQuality([
    "CÔNG BÁO/Số 10\nĐiều 1. Phạm vi điều chỉnh\nNội dung trang một.\nTrang 1",
    "CÔNG BÁO/Số 10\nĐiều 2. Đối tượng áp dụng\nNội dung trang hai.\nTrang 2",
    "CÔNG BÁO/Số 10\nĐiều 3. Hiệu lực thi hành\nNội dung trang ba.\nTrang 3",
  ]);
  assert.equal(pages.some((page) => page.includes("CÔNG BÁO")), false);
  assert.equal(pages.some((page) => /Trang \d/.test(page)), false);
  assert.equal(pages[0].includes("Điều 1"), true);
  assert.equal(pages[2].includes("Điều 3"), true);
});
