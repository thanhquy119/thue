import assert from "node:assert/strict";
import test from "node:test";
import { verifiedExtraQuestionResponse } from "../lib/legal/verified-question-rules-extra.ts";

test("Circular 97 repeal question stays anchored to the verified current document", () => {
  const result = verifiedExtraQuestionResponse(
    "Thông tư 97/2026/TT-BTC bãi bỏ văn bản nào?",
  );
  assert.ok(result);
  assert.match(result.direct_answer, /55\/2010\/TT-BTC/);
  assert.match(result.direct_answer, /06\/07\/2026/);
  assert.ok(result.candidates.some((candidate) => candidate.number === "97/2026/TT-BTC"));
  assert.equal(result.confidence, 0.99);
});
