import assert from "node:assert/strict";
import test from "node:test";
import { evaluateProductionOcrText } from "../lib/legal/ocr-production.ts";

function legalPage(page: number) {
  return `--- TRANG ${page} ---\nĐiều ${page}. Nội dung quy định tại trang ${page}\n1. Cơ quan, tổ chức và cá nhân có trách nhiệm thi hành quy định này.\n2. Việc thực hiện phải bảo đảm đúng trình tự, thủ tục và thời hạn theo pháp luật.`;
}

test("accepts a complete legal OCR transcript", () => {
  const text = Array.from({ length: 5 }, (_, index) => legalPage(index + 1)).join("\n\n");
  const result = evaluateProductionOcrText(text, 5, "STOP");
  assert.equal(result.accepted, true, result.warnings.join(" "));
  assert.ok(result.score >= 0.68);
  assert.match(result.text, /Điều 5/u);
});

test("rejects output stopped by the token limit", () => {
  const text = Array.from({ length: 5 }, (_, index) => legalPage(index + 1)).join("\n\n");
  const result = evaluateProductionOcrText(text, 5, "MAX_TOKENS");
  assert.equal(result.accepted, false);
  assert.ok(result.warnings.some((warning) => warning.includes("không trọn vẹn")));
});

test("rejects a transcript that covers too few pages", () => {
  const text = Array.from({ length: 2 }, (_, index) => legalPage(index + 1)).join("\n\n");
  const result = evaluateProductionOcrText(text, 10, "STOP");
  assert.equal(result.accepted, false);
  assert.ok(result.warnings.some((warning) => warning.includes("2/10 trang")));
});

test("rejects excessive unreadable regions", () => {
  const text = Array.from({ length: 4 }, (_, index) => `${legalPage(index + 1)}\n${"[không đọc rõ] ".repeat(4)}`).join("\n\n");
  const result = evaluateProductionOcrText(text, 4, "STOP");
  assert.equal(result.accepted, false);
  assert.ok(result.warnings.some((warning) => warning.includes("vùng [không đọc rõ]")));
});
