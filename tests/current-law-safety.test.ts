import assert from "node:assert/strict";
import test from "node:test";
import {
  blockedCurrentLawResponse,
  currentLawDecision,
  currentLawDocuments,
  legalTimeIntent,
  requiresCurrentEffectiveLaw,
} from "../lib/legal/current-law-safety.ts";
import type { DocumentDetail, EffectiveStatus, TaxSearchResponse } from "../lib/legal/types.ts";

function document(status: EffectiveStatus, overrides: Partial<DocumentDetail> = {}): DocumentDetail {
  return {
    id: `doc-${status}`,
    number: "10/2012/QH13",
    title: "Luật thuế giả lập để kiểm tra trạng thái hiệu lực",
    type: "Luật",
    issuer: "Quốc hội",
    issued_date: "2012-06-20",
    effective_date: status === "unknown" ? null : "2013-01-01",
    status,
    source_url: "https://vanban.chinhphu.vn/van-ban/10-2012-qh13",
    source_label: "Cổng thông tin Chính phủ",
    last_verified_at: "2026-07-27T00:00:00.000Z",
    extraction_method: "html",
    quality_score: 0.98,
    verification_notes: null,
    official_text: "Điều 1. Quy định về kê khai thuế.",
    provisions: [],
    ...overrides,
  };
}

function response(doc: DocumentDetail): TaxSearchResponse {
  return {
    query_normalized: "ke khai thue nhu the nao",
    query_kind: "question",
    direct_answer: "Câu trả lời cũ không được phép xuất hiện.",
    document: doc,
    candidates: [],
    warnings: [],
    confidence: 0.9,
    retrieved_at: "2026-07-27T00:00:00.000Z",
  };
}

test("defaults ordinary tax questions to current-law intent", () => {
  assert.equal(legalTimeIntent("Kê khai thuế như thế nào?", 2026), "current");
  assert.equal(requiresCurrentEffectiveLaw("Kê khai thuế như thế nào?"), true);
});

test("an old year inside a document number does not silently turn the question historical", () => {
  assert.equal(legalTimeIntent("Theo Luật 10/2012/QH13 thì kê khai thuế như thế nào?", 2026), "current");
  assert.equal(currentLawDecision("Theo Luật 10/2012/QH13 thì kê khai thuế như thế nào?", document("unknown")).allowed, false);
});

test("explicit historical, relationship and future questions keep their intended time scope", () => {
  assert.equal(legalTimeIntent("Tại thời điểm năm 2012 kê khai thuế như thế nào?", 2026), "historical");
  assert.equal(legalTimeIntent("Luật 10/2012/QH13 còn hiệu lực không?", 2026), "relationship");
  assert.equal(legalTimeIntent("Quy định sẽ áp dụng từ năm 2027 là gì?", 2026), "future");
});

test("current questions accept only effective or partially effective documents", () => {
  for (const status of ["unknown", "upcoming", "expired", "repealed"] as const) {
    assert.equal(currentLawDecision("Kê khai thuế như thế nào?", document(status)).allowed, false, status);
  }
  assert.equal(currentLawDecision("Kê khai thuế như thế nào?", document("effective")).allowed, true);
  assert.equal(currentLawDecision("Kê khai thuế như thế nào?", document("partially_effective")).allowed, true);
});

test("document age alone never disqualifies a verified effective law", () => {
  const oldButVerified = document("effective", { issued_date: "2012-06-20", effective_date: "2013-01-01" });
  assert.equal(currentLawDecision("Kê khai thuế như thế nào?", oldButVerified).allowed, true);
});

test("historical and legal-relationship questions may inspect non-current documents", () => {
  assert.equal(currentLawDecision("Tại thời điểm năm 2012 quy định ra sao?", document("expired")).allowed, true);
  assert.equal(currentLawDecision("Văn bản nào thay thế Luật 10/2012/QH13?", document("unknown")).allowed, true);
});

test("future questions may use upcoming law but still reject unknown status", () => {
  assert.equal(currentLawDecision("Quy định áp dụng từ năm 2027 là gì?", document("upcoming")).allowed, true);
  assert.equal(currentLawDecision("Quy định áp dụng từ năm 2027 là gì?", document("unknown")).allowed, false);
});

test("filters mixed evidence before it reaches the answer model", () => {
  const effective = document("effective", { id: "effective", number: "90/2026/TT-BTC", issued_date: "2026-06-30" });
  const unknown = document("unknown", { id: "unknown", number: "10/2012/QH13" });
  const expired = document("expired", { id: "expired", number: "20/2012/TT-BTC" });
  const selected = currentLawDocuments("Kê khai thuế như thế nào?", [unknown, effective, expired]);
  assert.deepEqual(selected.eligible.map((item) => item.number), ["90/2026/TT-BTC"]);
  assert.equal(selected.excluded.length, 2);
  assert.ok(selected.warnings.some((warning) => warning.includes("10/2012/QH13")));
});

test("blocked response removes the unverified document and its stale answer", () => {
  const unknown = document("unknown");
  const blocked = blockedCurrentLawResponse("Kê khai thuế như thế nào?", response(unknown), unknown);
  assert.equal(blocked.document, null);
  assert.deepEqual(blocked.candidates, []);
  assert.doesNotMatch(blocked.direct_answer, /Câu trả lời cũ/iu);
  assert.match(blocked.direct_answer, /chưa xác minh.*còn hiệu lực/iu);
  assert.ok(blocked.confidence <= 0.38);
});
