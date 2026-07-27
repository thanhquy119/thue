import assert from "node:assert/strict";
import test from "node:test";
import { answerQuestionFromAnchors } from "../lib/legal/anchored-question.ts";
import type { DocumentDetail } from "../lib/legal/types.ts";

function unknownOldLaw(): DocumentDetail {
  return {
    id: "law-2012-unknown",
    number: "10/2012/QH13",
    title: "Luật thuế giả lập chưa xác minh hiệu lực",
    type: "Luật",
    issuer: "Quốc hội",
    issued_date: "2012-06-20",
    effective_date: null,
    status: "unknown",
    source_url: "https://vanban.chinhphu.vn/van-ban/10-2012-qh13",
    source_label: "Cổng thông tin Chính phủ",
    last_verified_at: "2026-07-27T00:00:00.000Z",
    extraction_method: "html",
    quality_score: 0.98,
    verification_notes: null,
    official_text: "Điều 1. Người nộp thuế thực hiện kê khai theo quy định.",
    provisions: [{
      id: "law-2012-unknown-1",
      type: "article",
      identifier: "Điều 1",
      article: "1",
      heading: null,
      official_text: "Điều 1. Người nộp thuế thực hiện kê khai theo quy định.",
      order_index: 0,
    }],
  };
}

test("blocks an explicitly cited old law with unknown status for a current filing question", async () => {
  const result = await answerQuestionFromAnchors(
    "Theo Luật 10/2012/QH13 thì hiện nay kê khai thuế như thế nào?",
    [unknownOldLaw()],
  );
  assert.equal(result.document, null);
  assert.deepEqual(result.candidates, []);
  assert.match(result.direct_answer, /chưa xác minh.*còn hiệu lực/iu);
  assert.doesNotMatch(result.direct_answer, /Người nộp thuế thực hiện kê khai/iu);
  assert.ok(result.confidence <= 0.38);
});
