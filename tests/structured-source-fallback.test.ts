import assert from "node:assert/strict";
import test from "node:test";
import { resolveCurrentTaxDocumentNumber } from "../lib/legal/current-tax-document-alias.ts";
import { responseFromDurableRecord } from "../lib/legal/durable-document-lookup-core.ts";
import type { DurableIngestionState } from "../lib/legal/durable-ingestion-types.ts";
import {
  findRecentDocumentByNumber,
  preferredRecentDocumentDownload,
} from "../lib/legal/recent-document-definitions.ts";

test("resolves the latest Circular 89 lookup to the current tax document", () => {
  assert.equal(resolveCurrentTaxDocumentNumber("thông tư 89 mới nhất"), "89/2026/TT-BTC");
});

test("Circular 89 has a structured main source and a required appendix", () => {
  const definition = findRecentDocumentByNumber("89/2026/TT-BTC");
  assert.ok(definition);
  assert.equal(definition.preferCuratedSource, true);
  assert.match(preferredRecentDocumentDownload(definition.number)?.fileName ?? "", /\.docx$/iu);
  assert.equal(definition.attachments?.length, 1);
  assert.match(definition.attachments?.[0]?.fileName ?? "", /phu luc.*\.doc$/iu);
});

test("compacts hundreds of missing OCR pages into one readable warning", () => {
  const state: DurableIngestionState = {
    number: "89/2026/TT-BTC",
    status: "needs_review",
    stage: "completed",
    runId: "run-89",
    sourceUrl: "https://vanban.chinhphu.vn/89",
    extractionMethod: "ocr",
    processedPages: 254,
    totalPages: 839,
    qualityScore: 0.7,
    warnings: [
      "Thiếu nội dung đạt yêu cầu ở trang 48, 77, 96, 97, 104, 105, 106, 119, 122, 127 (254/839 trang).",
    ],
    error: null,
    updatedAt: new Date(0).toISOString(),
  };

  const response = responseFromDurableRecord(
    "thông tư 89 mới nhất",
    "89/2026/TT-BTC",
    state,
    null,
  );

  assert.equal(response?.document, null);
  assert.match(response?.direct_answer ?? "", /254\/839 trang/iu);
  assert.match(response?.warnings[0] ?? "", /585\/839 trang/iu);
  assert.match(response?.warnings[0] ?? "", /96–97/iu);
  assert.ok((response?.warnings[0]?.length ?? 0) < 220);
});
