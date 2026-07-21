import assert from "node:assert/strict";
import test from "node:test";
import { currentBackboneQueries, questionSearchQueries } from "../lib/legal/discovery.ts";

test("registration questions include the current registration circular and tax law", () => {
  const queries = questionSearchQueries("Doanh nghiệp chuyển địa chỉ sang tỉnh khác có phải hoàn thành nghĩa vụ thuế trước không?");
  assert.ok(queries.includes("90/2026/TT-BTC"));
  assert.ok(queries.includes("108/2025/QH15"));
});

test("household revenue questions include the current threshold and procedure documents", () => {
  const queries = currentBackboneQueries("Hộ kinh doanh doanh thu 800 triệu có phải nộp thuế không?");
  assert.ok(queries.includes("141/2026/NĐ-CP"));
  assert.ok(queries.includes("50/2026/TT-BTC"));
});

test("invoice questions include the July 2026 invoice backbone documents", () => {
  const queries = questionSearchQueries("Tiền đặt cọc có phải lập hóa đơn điện tử không?");
  assert.ok(queries.includes("254/2026/NĐ-CP"));
  assert.ok(queries.includes("91/2026/TT-BTC"));
});

test("corporate income tax questions include current corporate tax documents", () => {
  const queries = currentBackboneQueries("Doanh nghiệp mới thành lập có phải tạm nộp thuế TNDN không?");
  assert.ok(queries.includes("141/2026/NĐ-CP"));
  assert.ok(queries.includes("320/2025/NĐ-CP"));
});

test("ordinary document lookup remains a single query", () => {
  assert.deepEqual(questionSearchQueries("108/2025/QH15"), ["108/2025/QH15"]);
});
