import assert from "node:assert/strict";
import test from "node:test";
import { buildDocumentSearchQueries, extractSearchHint, normalizeLegalQuery } from "../lib/legal/query.ts";

test("natural document names keep their type and trailing number", () => {
  for (const query of [
    "Luật quản lý thuế 108",
    "luat quan li thue 108",
    "Luật 108 quản lý thuế",
  ]) {
    const hint = extractSearchHint(query);
    assert.equal(hint.type, "Luật");
    assert.equal(hint.number, "108");
    assert.equal(hint.asksQuestion, false);
  }
});

test("full identifiers keep number, year and document type", () => {
  const hint = extractSearchHint("Thông tư số 89/2026/TT-BTC");
  assert.equal(hint.type, "Thông tư");
  assert.equal(hint.number, "89");
  assert.equal(hint.year, "2026");
  assert.equal(hint.asksQuestion, false);
});

test("natural year phrases keep the requested year instead of falling back to older documents", () => {
  for (const query of [
    "thông tư 90 năm 2026 bộ tài chính",
    "Thông tư số 90 Bộ Tài chính năm 2026",
  ]) {
    const hint = extractSearchHint(query);
    assert.equal(hint.type, "Thông tư", query);
    assert.equal(hint.number, "90", query);
    assert.equal(hint.year, "2026", query);
    assert.equal(hint.asksQuestion, false, query);
  }
});

test("tax questions are not mistaken for document-number lookups", () => {
  const hint = extractSearchHint("Hộ kinh doanh doanh thu 300 triệu có phải nộp thuế không?");
  assert.equal(hint.asksQuestion, true);
  assert.equal(hint.number, null);
});

test("document lookup creates identifier and title variants", () => {
  const variants = buildDocumentSearchQueries("Luật quản lý thuế 108").map(normalizeLegalQuery);
  assert.ok(variants.some((value) => value.includes("luat 108")));
  assert.ok(variants.some((value) => value.includes("quan ly thue")));
});

test("natural year lookup creates an exact identifier search variant", () => {
  const variants = buildDocumentSearchQueries("thông tư 90 năm 2026 bộ tài chính").map(normalizeLegalQuery);
  assert.ok(variants.some((value) => value.includes("thong tu 90/2026")));
  assert.equal(variants.some((value) => /90\/2024/.test(value)), false);
});
