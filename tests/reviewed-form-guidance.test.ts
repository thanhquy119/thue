import assert from "node:assert/strict";
import test from "node:test";
import {
  answerFromReviewedFormGuidance,
  requestedFormFieldNumbers,
  reviewedFormGuidanceEvidence,
  reviewedFormGuidanceForQuery,
} from "../lib/legal/reviewed-form-guidance.ts";
import type { DocumentDetail } from "../lib/legal/types.ts";

const document89: DocumentDetail = {
  id: "89-2026-tt-btc",
  number: "89/2026/TT-BTC",
  title: "Quy định chi tiết một số điều của Luật Quản lý thuế",
  type: "Thông tư",
  issuer: "Bộ Tài chính",
  issued_date: "2026-06-30",
  effective_date: "2026-07-01",
  status: "effective",
  source_url: "https://vanban.chinhphu.vn/89",
  source_label: "Cổng Thông tin điện tử Chính phủ",
  last_verified_at: new Date(0).toISOString(),
  extraction_method: "docx+doc",
  quality_score: 1,
  verification_notes: null,
  official_text: "Nội dung chính không có lớp chữ của các ô biểu mẫu.",
  provisions: [],
};

test("matches Circular 89 fields 37 and 38 from a natural form question", () => {
  const query = "Hướng dẫn chi tiết kê khai chỉ tiêu 37, 38 trên tờ khai khấu trừ theo thông tư 89/2026";
  const guidance = reviewedFormGuidanceForQuery(query, [document89]);

  assert.ok(guidance);
  assert.equal(guidance.formNumber, "01/GTGT");
  assert.deepEqual(requestedFormFieldNumbers(query), [37, 38]);

  const answer = answerFromReviewedFormGuidance(guidance, [37, 38]);
  assert.match(answer, /Chỉ tiêu \[37\].*điều chỉnh giảm/isu);
  assert.match(answer, /Chỉ tiêu \[38\].*điều chỉnh tăng/isu);
  assert.match(answer, /05 triệu đồng/iu);
  assert.match(answer, /thanh toán không dùng tiền mặt/iu);
  assert.match(answer, /hóa đơn điều chỉnh|hóa đơn thay thế/iu);
  assert.match(answer, /phương pháp trực tiếp/iu);
});

test("does not mistake the 01/GTGT form number for a requested field", () => {
  const fields = requestedFormFieldNumbers(
    "Cách ghi chỉ tiêu 37 và 38 trên Mẫu 01/GTGT theo Thông tư 89/2026/TT-BTC",
  );
  assert.deepEqual(fields, [37, 38]);
});

test("does not activate form guidance for a question about legal articles", () => {
  const guidance = reviewedFormGuidanceForQuery(
    "Điều 37 và Điều 38 Thông tư 89/2026/TT-BTC quy định nội dung gì?",
    [document89],
  );
  assert.equal(guidance, null);
});

test("reviewed evidence declares its provenance and legal references", () => {
  const guidance = reviewedFormGuidanceForQuery(
    "Kê khai chỉ tiêu 37 38 trên tờ khai khấu trừ theo Thông tư 89/2026",
    [document89],
  );
  assert.ok(guidance);
  const evidence = reviewedFormGuidanceEvidence(guidance, [37, 38]);
  const text = evidence.excerpts.join("\n");

  assert.match(evidence.title, /Hướng dẫn biểu mẫu đã đối chiếu/iu);
  assert.match(text, /Trang công bố chính thức/iu);
  assert.match(text, /Ghi chú 5 Mẫu số 01\/GTGT/iu);
  assert.match(text, /Điều 12 Nghị định 252\/2026\/NĐ-CP/iu);
});
