import assert from "node:assert/strict";
import test from "node:test";
import { verifiedExtraQuestionResponse } from "../lib/legal/verified-question-rules-extra.ts";

test("cross-province head-office moves keep the existing tax number", () => {
  const result = verifiedExtraQuestionResponse(
    "Doanh nghiệp chuyển trụ sở sang tỉnh khác có phải đổi mã số thuế không?",
  );
  assert.ok(result);
  assert.match(result.direct_answer, /^Không\./);
  assert.match(result.direct_answer, /vẫn sử dụng mã số thuế đã được cấp/);
  assert.ok(result.candidates.some((candidate) => candidate.number === "90/2026/TT-BTC"));
  assert.ok(result.confidence >= 0.95);
});
