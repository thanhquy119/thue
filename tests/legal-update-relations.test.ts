import assert from "node:assert/strict";
import test from "node:test";
import { findLatestLegalUpdate, relationKindForSource } from "../lib/legal/legal-update-relations.ts";
import type { DocumentDetail, OnlineLegalSource } from "../lib/legal/types.ts";

const oldDocument: DocumentDetail = {
  id: "86-2024",
  number: "86/2024/TT-BTC",
  title: "Quy định về đăng ký thuế",
  type: "Thông tư",
  issuer: "Bộ Tài chính",
  issued_date: "2024-12-23",
  effective_date: "2025-02-06",
  status: "effective",
  source_url: "https://example.test/86",
  source_label: "Nguồn thử nghiệm",
  last_verified_at: "2026-07-21T00:00:00.000Z",
  extraction_method: "docx",
  quality_score: 1,
  verification_notes: null,
  official_text: "Nội dung",
  provisions: [],
};

function source(overrides: Partial<OnlineLegalSource>): OnlineLegalSource {
  return {
    id: "source",
    title: "",
    url: "https://example.test/source",
    snippet: "",
    score: 1,
    source_label: "Nguồn thử nghiệm",
    ...overrides,
  };
}

test("detects a newer document that replaces an older circular", () => {
  const replacement = source({
    id: "90-2026",
    document_number: "90/2026/TT-BTC",
    document_type: "Thông tư",
    issued_date: "2026-06-30",
    title: "Thông tư 90/2026/TT-BTC quy định về đăng ký thuế",
    snippet: "Thông tư này thay thế Thông tư số 86/2024/TT-BTC.",
  });
  assert.equal(relationKindForSource(oldDocument.number, replacement), "replacement");
  const found = findLatestLegalUpdate(oldDocument, [replacement]);
  assert.equal(found?.documentNumber, "90/2026/TT-BTC");
  assert.equal(found?.kind, "replacement");
});

test("ignores a source that merely mentions the old document without a legal relation", () => {
  const unrelated = source({
    id: "guide",
    document_number: "12/2026/TT-BTC",
    issued_date: "2026-03-01",
    title: "Hướng dẫn nghiệp vụ",
    snippet: "Tài liệu có dẫn chiếu Thông tư 86/2024/TT-BTC để tham khảo.",
  });
  assert.equal(relationKindForSource(oldDocument.number, unrelated), null);
  assert.equal(findLatestLegalUpdate(oldDocument, [unrelated]), null);
});

test("ignores older amendment sources", () => {
  const older = source({
    id: "older",
    document_number: "12/2023/TT-BTC",
    issued_date: "2023-05-01",
    title: "Sửa đổi Thông tư 86/2024/TT-BTC",
  });
  assert.equal(findLatestLegalUpdate(oldDocument, [older]), null);
});
