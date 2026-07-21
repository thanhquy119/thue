import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeTaxQuestion,
  answerGroundingIssues,
  clarificationForTaxQuestion,
  enrichTaxQuestion,
} from "../lib/legal/question-intelligence.ts";

test("classifies a detailed VAT refund question", () => {
  const plan = analyzeTaxQuestion("Doanh nghiệp hoàn thuế GTGT thì cần hồ sơ gì và thời hạn xử lý bao lâu?");
  assert.equal(plan.isQuestion, true);
  assert.ok(plan.taxAreas.includes("thuế giá trị gia tăng"));
  assert.ok(plan.subjects.includes("doanh nghiệp, tổ chức"));
  assert.ok(plan.intents.includes("hoàn thuế"));
  assert.ok(plan.intents.includes("khai thuế, hồ sơ và mẫu biểu"));
  assert.ok(plan.intents.includes("thời hạn khai, nộp và xử lý"));
});

test("does not rewrite a long natural document lookup as a question", () => {
  const query = "Luật quản lý thuế số 108 năm 2025 của Quốc hội";
  const plan = analyzeTaxQuestion(query);
  assert.equal(plan.isQuestion, false);
  assert.equal(enrichTaxQuestion(query, plan), query);
});

test("asks for clarification when a tax-rate question is too vague", () => {
  const query = "Thuế suất bao nhiêu?";
  const message = clarificationForTaxQuestion(query);
  assert.match(message ?? "", /loại thuế/i);
  assert.match(message ?? "", /đối tượng/i);
});

test("enriches current questions with effective-law context", () => {
  const query = "Hộ kinh doanh doanh thu 500 triệu có phải nộp thuế không?";
  const enriched = enrichTaxQuestion(query, analyzeTaxQuestion(query), new Date("2026-07-21T00:00:00Z"));
  assert.match(enriched, /21\/07\/2026/);
  assert.match(enriched, /còn hiệu lực/);
  assert.match(enriched, /sửa đổi, bổ sung, thay thế/);
});

test("keeps an explicit tax year instead of forcing the current period", () => {
  const query = "Quyết toán thuế TNCN năm 2024 cần hồ sơ gì?";
  const enriched = enrichTaxQuestion(query, analyzeTaxQuestion(query), new Date("2026-07-21T00:00:00Z"));
  assert.match(enriched, /thời kỳ người dùng nêu: 2024/);
  assert.doesNotMatch(enriched, /áp dụng tại ngày/);
});

test("detects unsupported percentage claims", () => {
  const issues = answerGroundingIssues(
    "Theo 01/2026/TT-BTC, thuế suất là 8%.",
    "Thông tư 01/2026/TT-BTC quy định thuế suất 10%.",
    ["01/2026/TT-BTC"],
  );
  assert.ok(issues.includes("unsupported_numeric_claim"));
});

test("accepts document numbers and figures present in evidence", () => {
  const issues = answerGroundingIssues(
    "Theo 01/2026/TT-BTC, thuế suất là 10%.",
    "Thông tư 01/2026/TT-BTC quy định thuế suất 10%.",
    ["01/2026/TT-BTC"],
  );
  assert.deepEqual(issues, []);
});
