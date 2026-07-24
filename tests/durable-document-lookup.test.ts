import assert from "node:assert/strict";
import test from "node:test";
import {
  extractExactLegalNumber,
  responseFromDurableRecord,
} from "../lib/legal/durable-document-lookup-core.ts";
import type { DurablePublishedRevision } from "../lib/legal/durable-document-store.ts";
import type { DurableIngestionState } from "../lib/legal/durable-ingestion-types.ts";

function state(status: DurableIngestionState["status"]): DurableIngestionState {
  return {
    number: "94/2026/TT-BTC",
    status,
    stage: status === "processing" ? "ocr_processing" : "completed",
    runId: "run-1",
    sourceUrl: "https://datafiles.chinhphu.vn/94-btc.pdf",
    extractionMethod: status === "processing" ? "ocr" : null,
    processedPages: 6,
    totalPages: 20,
    qualityScore: 0.72,
    warnings: status === "needs_review" ? ["Thiếu trang 7."] : [],
    error: status === "failed" ? "Nguồn tạm thời không phản hồi." : null,
    updatedAt: new Date(0).toISOString(),
  };
}

function revision(): DurablePublishedRevision {
  return {
    revisionId: "revision-1",
    sourceSha256: "abc",
    sourceBlobUrl: null,
    publishedAt: new Date(0).toISOString(),
    validation: {
      accepted: true,
      status: "ready",
      warnings: [],
      metrics: {
        characters: 5000,
        legalMarkers: 20,
        articleMarkers: 15,
        chapterMarkers: 2,
        unreadableMarkers: 0,
        coveredPages: 20,
        totalPages: 20,
        pageCoverage: 1,
        minimumPageScore: 0.8,
      },
    },
    document: {
      id: "94-2026-tt-btc",
      number: "94/2026/TT-BTC",
      title: "Quy định về quản lý tuân thủ, quản lý rủi ro trong quản lý thuế",
      type: "Thông tư",
      issuer: "Bộ Tài chính",
      issued_date: "2026-07-01",
      effective_date: "2026-07-01",
      status: "effective",
      source_url: "https://vanban.chinhphu.vn/94",
      source_label: "Cổng Chính phủ",
      last_verified_at: new Date(0).toISOString(),
      extraction_method: "ocr",
      quality_score: 0.86,
      verification_notes: "Đã kiểm tra.",
      official_text: "BỘ TÀI CHÍNH\nSố: 94/2026/TT-BTC\nĐiều 1. Phạm vi\nĐiều 2. Đối tượng",
      provisions: [],
    },
  };
}

test("extracts an exact Vietnamese legal document number", () => {
  assert.equal(
    extractExactLegalNumber("Cho tôi toàn văn Thông tư 94 / 2026 / TT-BTC"),
    "94/2026/TT-BTC",
  );
  assert.equal(extractExactLegalNumber("Quy định thuế mới nhất là gì?"), null);
});

test("returns an accepted durable revision as the primary document", () => {
  const response = responseFromDurableRecord(
    "94/2026/TT-BTC",
    "94/2026/TT-BTC",
    state("ready"),
    revision(),
  );
  assert.equal(response?.document?.number, "94/2026/TT-BTC");
  assert.equal(response?.confidence, 0.99);
});

test("never publishes text while OCR is still processing", () => {
  const response = responseFromDurableRecord(
    "94/2026/TT-BTC",
    "94/2026/TT-BTC",
    state("processing"),
    null,
  );
  assert.equal(response?.document, null);
  assert.match(response?.direct_answer ?? "", /đang xử lý nền/i);
});

test("keeps needs-review and failed results as metadata-only candidates", () => {
  const review = responseFromDurableRecord(
    "94/2026/TT-BTC",
    "94/2026/TT-BTC",
    state("needs_review"),
    null,
  );
  assert.equal(review?.document, null);
  assert.match(review?.warnings.join(" ") ?? "", /Thiếu trang 7/i);

  const failed = responseFromDurableRecord(
    "94/2026/TT-BTC",
    "94/2026/TT-BTC",
    state("failed"),
    null,
  );
  assert.equal(failed?.document, null);
  assert.match(failed?.warnings.join(" ") ?? "", /không phản hồi/i);
});
