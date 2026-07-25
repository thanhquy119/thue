import assert from "node:assert/strict";
import test from "node:test";
import {
  findRecentDocumentByNumber,
  findRecentDocumentForQuery,
} from "../lib/legal/recent-document-definitions.ts";

test("recognizes exact lookup for Circular 90/2026/TT-BTC", () => {
  const document = findRecentDocumentForQuery("90/2026/TT-BTC");
  assert.equal(document?.number, "90/2026/TT-BTC");
  assert.equal(document?.downloads[0]?.mimeType.includes("wordprocessingml"), true);
  assert.match(document?.officialPage ?? "", /docid=218839/i);
});

test("recognizes natural lookup with number, named year and finance issuer", () => {
  const document = findRecentDocumentForQuery("thông tư 90 năm 2026 bộ tài chính");
  assert.equal(document?.number, "90/2026/TT-BTC");
});

test("does not guess a ministry circular when the issuer is missing", () => {
  assert.equal(findRecentDocumentForQuery("thông tư 90 năm 2026"), null);
});

test("recognizes Circular 91 with its reviewed full-text sources", () => {
  const document = findRecentDocumentForQuery("91/2026/TT-BTC");
  assert.equal(document?.number, "91/2026/TT-BTC");
  assert.equal(document?.downloads[0]?.mimeType, "text/html");
  assert.match(document?.downloads[0]?.textStartMarker ?? "", /BỘ TÀI CHÍNH/i);
  assert.equal(document?.downloads.some((download) => download.mimeType === "application/pdf"), true);
  assert.match(document?.officialPage ?? "", /thong-tu-91-2026-tt-btc/i);
});

test("recognizes Circular 94 while avoiding unsafe full-document OCR", () => {
  const document = findRecentDocumentForQuery("Thông tư 94/2026/TT-BTC");
  assert.equal(document?.number, "94/2026/TT-BTC");
  assert.match(document?.officialPage ?? "", /docid=218894/i);
  assert.equal(document?.downloads.length, 0);
  assert.match(document?.fullTextUnavailableReason ?? "", /PDF scan/i);
  assert.match(document?.fullTextUnavailableReason ?? "", /OCR/i);
});

test("does not intercept unrelated document numbers", () => {
  assert.equal(findRecentDocumentForQuery("92/2026/TT-BTC"), null);
  assert.equal(findRecentDocumentByNumber("94/2025/TT-BTC"), null);
});
