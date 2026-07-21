import assert from "node:assert/strict";
import test from "node:test";
import {
  extractAnchoredReferences,
  isAnchoredLegalQuestion,
} from "../lib/legal/anchored-question.ts";

test("analysis request keeps the cited finance circular as its anchor", () => {
  const query = "Phân tích văn bản bổ sung dựa trên Thông tư 89/2026/BTC";
  const references = extractAnchoredReferences(query);
  assert.equal(isAnchoredLegalQuestion(query), true);
  assert.equal(references.length, 1);
  assert.deepEqual(references[0], {
    type: "Thông tư",
    number: "89",
    year: "2026",
    suffix: "TT-BTC",
    lookupQuery: "Thông tư 89/2026/TT-BTC",
  });
});

test("a direct identifier lookup is not changed into an nghiệp vụ question", () => {
  const query = "Thông tư 89/2026/TT-BTC";
  assert.equal(isAnchoredLegalQuestion(query), false);
});

test("questions beginning with theo keep the cited document as an anchor", () => {
  const query = "Theo Nghị định 100/2024/NĐ-CP thì quy định này áp dụng như thế nào?";
  const references = extractAnchoredReferences(query);
  assert.equal(isAnchoredLegalQuestion(query), true);
  assert.equal(references[0]?.lookupQuery, "Nghị định 100/2024/NĐ-CP");
});
