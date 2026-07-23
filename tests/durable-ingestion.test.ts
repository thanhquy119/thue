import assert from "node:assert/strict";
import test from "node:test";
import {
  documentStorageKey,
  extractionPriority,
  pageBatches,
  validateDurableLegalText,
  type DurableOcrPage,
} from "../lib/legal/durable-ingestion-types.ts";

function legalText(number = "94/2026/TT-BTC") {
  return `
BỘ TÀI CHÍNH
Số: ${number}
Hà Nội, ngày 1 tháng 7 năm 2026
THÔNG TƯ
QUY ĐỊNH VỀ QUẢN LÝ TUÂN THỦ, QUẢN LÝ RỦI RO TRONG QUẢN LÝ THUẾ

Điều 1. Phạm vi điều chỉnh
Thông tư này quy định về quản lý tuân thủ và quản lý rủi ro trong quản lý thuế.

Điều 2. Đối tượng áp dụng
Người nộp thuế, cơ quan quản lý thuế và tổ chức, cá nhân có liên quan thực hiện theo quy định.

Điều 3. Nguyên tắc thực hiện
Việc đánh giá rủi ro phải khách quan, minh bạch và dựa trên dữ liệu.
`.repeat(7);
}

function page(page: number, score = 0.82, similarity = 0.95): DurableOcrPage {
  return {
    page,
    text: `Trang ${page}. Nội dung pháp lý đủ dài để xác nhận lớp chữ của trang này trong toàn văn.`.repeat(3),
    score,
    similarity,
    chosenPass: "consensus",
    notices: [],
  };
}

test("uses DOCX before DOC, PDF text, HTML and OCR", () => {
  assert.ok(extractionPriority("docx") < extractionPriority("doc"));
  assert.ok(extractionPriority("doc") < extractionPriority("pdf_text"));
  assert.ok(extractionPriority("pdf_text") < extractionPriority("html"));
  assert.ok(extractionPriority("html") < extractionPriority("ocr"));
});

test("splits OCR into deterministic page batches", () => {
  assert.deepEqual(pageBatches(8, 3), [[1, 2, 3], [4, 5, 6], [7, 8]]);
  assert.deepEqual(pageBatches(0, 3), []);
});

test("creates a stable storage key from a Vietnamese document number", () => {
  assert.equal(documentStorageKey("94/2026/TT-BTC"), "94-2026-tt-btc");
});

test("accepts complete legal OCR matching number, date and all pages", () => {
  const result = validateDurableLegalText({
    expectedNumber: "94/2026/TT-BTC",
    issuedDate: "2026-07-01",
    text: legalText(),
    extractionMethod: "ocr",
    qualityScore: 0.84,
    totalPages: 4,
    pages: [page(1), page(2), page(3), page(4)],
  });
  assert.equal(result.accepted, true);
  assert.equal(result.metrics.pageCoverage, 1);
});

test("requires review when one OCR page is missing", () => {
  const result = validateDurableLegalText({
    expectedNumber: "94/2026/TT-BTC",
    issuedDate: "2026-07-01",
    text: legalText(),
    extractionMethod: "ocr",
    qualityScore: 0.84,
    totalPages: 4,
    pages: [page(1), page(2), page(4)],
  });
  assert.equal(result.status, "needs_review");
  assert.match(result.warnings.join(" "), /trang 3/i);
});

test("requires review when the requested document number is absent", () => {
  const result = validateDurableLegalText({
    expectedNumber: "94/2026/TT-BTC",
    issuedDate: "2026-07-01",
    text: legalText("93/2026/TT-BTC"),
    extractionMethod: "pdf_text",
    qualityScore: 0.9,
  });
  assert.equal(result.accepted, false);
  assert.match(result.warnings.join(" "), /94\/2026\/TT-BTC/i);
});

test("requires review for portal shell even when it contains the number", () => {
  const shell = `
Thông tư số 94/2026/TT-BTC
English 中文 Trang chủ Chính phủ Nước CHXHCN Việt Nam
Thư điện tử công vụ Chính phủ Báo điện tử Chính phủ
Lai Châu 22° Điện Biên 23° Tuyên Quang 24°
Điều 1 Điều 2
`.repeat(20);
  const result = validateDurableLegalText({
    expectedNumber: "94/2026/TT-BTC",
    text: shell,
    extractionMethod: "html",
    qualityScore: 0.9,
  });
  assert.equal(result.accepted, false);
  assert.match(result.warnings.join(" "), /khung menu|Cổng Chính phủ/i);
});

test("requires review for low-quality or divergent OCR pages", () => {
  const result = validateDurableLegalText({
    expectedNumber: "94/2026/TT-BTC",
    issuedDate: "2026-07-01",
    text: `${legalText()}\n${"[không đọc rõ]\n".repeat(8)}`,
    extractionMethod: "ocr",
    qualityScore: 0.66,
    totalPages: 4,
    pages: [page(1), page(2, 0.59, 0.6), page(3), page(4)],
  });
  const warnings = result.warnings.join(" ");
  assert.equal(result.accepted, false);
  assert.match(warnings, /chất lượng/i);
  assert.match(warnings, /không đọc rõ/i);
  assert.match(warnings, /khác nhau/i);
});
