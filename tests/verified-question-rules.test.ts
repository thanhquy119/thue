import assert from "node:assert/strict";
import test from "node:test";
import { ensureBinaryConclusion, verifiedQuestionResponse } from "../lib/legal/verified-question-rules.ts";
import type { TaxSearchResponse } from "../lib/legal/types.ts";

test("broad 2026 registration questions return a current overview", () => {
  const result = verifiedQuestionResponse("Quy định đăng ký thuế trong năm 2026 như thế nào?");
  assert.ok(result);
  assert.match(result.direct_answer, /01\/07\/2026/);
  assert.match(result.direct_answer, /90\/2026\/TT-BTC/);
  assert.match(result.direct_answer, /thay thế Thông tư số 86\/2024\/TT-BTC/);
  assert.ok(result.candidates.some((candidate) => candidate.number === "108/2025/QH15"));
});

test("specific registration questions stay in the ordinary retrieval flow", () => {
  const result = verifiedQuestionResponse("Doanh nghiệp chuyển địa chỉ sang tỉnh khác có phải hoàn thành nghĩa vụ thuế trước không?");
  assert.equal(result, null);
});

test("current rental registration question returns a clear yes", () => {
  const result = verifiedQuestionResponse("Cho thuê nhà dưới 100 triệu thì có cần đăng ký thuế không?");
  assert.ok(result);
  assert.match(result.direct_answer, /^Có\./);
  assert.match(result.direct_answer, /không phải nộp thuế GTGT và thuế TNCN/);
  assert.ok(result.candidates?.some((candidate) => candidate.number === "90/2026/TT-BTC"));
  assert.ok(result.candidates?.some((candidate) => candidate.number === "141/2026/NĐ-CP"));
});

test("historical rental questions stay in the ordinary retrieval flow", () => {
  const result = verifiedQuestionResponse("Năm 2024 cho thuê nhà 100 triệu có cần đăng ký thuế không?");
  assert.equal(result, null);
});

function baseResult(answer: string): TaxSearchResponse {
  return {
    query_normalized: "test",
    query_kind: "question",
    direct_answer: answer,
    document: null,
    candidates: [],
    warnings: [],
    confidence: 0.8,
    retrieved_at: new Date().toISOString(),
  };
}

test("yes-no questions without a conclusion are marked inconclusive", () => {
  const result = ensureBinaryConclusion(
    "Cá nhân có cần đăng ký thuế không?",
    baseResult("Điều 4 quy định hồ sơ đăng ký thuế gồm các giấy tờ sau."),
  );
  assert.match(result.direct_answer, /^Chưa thể kết luận có hay không/);
  assert.ok(result.confidence <= 0.45);
});

test("an explicit no conclusion remains unchanged", () => {
  const original = baseResult("Không. Trường hợp này không thuộc diện phải đăng ký lại.");
  const result = ensureBinaryConclusion("Có cần đăng ký lại không?", original);
  assert.equal(result.direct_answer, original.direct_answer);
});
