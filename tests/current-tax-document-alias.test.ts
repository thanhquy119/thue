import assert from "node:assert/strict";
import test from "node:test";
import {
  currentTaxDocumentCandidates,
  resolveCurrentTaxDocumentNumber,
} from "../lib/legal/current-tax-document-alias.ts";

test("resolves natural short lookups to the unique current tax document", () => {
  assert.equal(resolveCurrentTaxDocumentNumber("Đọc nghị định 252"), "252/2026/NĐ-CP");
  assert.equal(resolveCurrentTaxDocumentNumber("mở Nghị định số 252"), "252/2026/NĐ-CP");
  assert.equal(resolveCurrentTaxDocumentNumber("thông tư 94 năm 2026 bộ tài chính"), "94/2026/TT-BTC");
  assert.equal(resolveCurrentTaxDocumentNumber("xem toàn văn thông tư 90"), "90/2026/TT-BTC");
  assert.equal(resolveCurrentTaxDocumentNumber("đọc luật 108"), "108/2025/QH15");
});

test("does not invent a document when the number is not in the current tax index", () => {
  assert.equal(resolveCurrentTaxDocumentNumber("Đọc nghị định 999"), null);
  assert.deepEqual(currentTaxDocumentCandidates("Đọc nghị định 999"), []);
});

test("does not turn an ordinary numeric nghiệp vụ query into a document lookup", () => {
  assert.equal(resolveCurrentTaxDocumentNumber("doanh thu 252 triệu có phải nộp thuế không"), null);
  assert.equal(resolveCurrentTaxDocumentNumber("252"), null);
});

test("respects an explicit year and issuer instead of silently choosing a near match", () => {
  assert.equal(resolveCurrentTaxDocumentNumber("thông tư 94 năm 2025 bộ tài chính"), null);
  assert.equal(resolveCurrentTaxDocumentNumber("nghị định 252 bộ tài chính"), null);
  assert.equal(resolveCurrentTaxDocumentNumber("thông tư 252 chính phủ"), null);
});

test("short aliases exclude internal tax-sector administration documents", () => {
  assert.equal(resolveCurrentTaxDocumentNumber("đọc nghị định 256"), null);
  assert.deepEqual(currentTaxDocumentCandidates("mở nghị định 256"), []);
});
