import assert from "node:assert/strict";
import test from "node:test";
import { disqualifyTaxSource } from "../lib/legal/tax-source-disqualifier.ts";

test("ordinary current nghiệp vụ questions reject repeal-only documents", () => {
  const rejected = disqualifyTaxSource(
    "Doanh nghiệp hoàn thuế GTGT thì cần hồ sơ gì và thời hạn xử lý bao lâu?",
    "Thông tư 18/2019/TT-BTC bãi bỏ toàn bộ Thông tư 134/2014/TT-BTC về gia hạn nộp thuế và hoàn thuế GTGT",
  );
  assert.equal(rejected, true);
});

test("questions specifically about repeal may use a repeal document", () => {
  const rejected = disqualifyTaxSource(
    "Văn bản nào bãi bỏ Thông tư 134/2014/TT-BTC?",
    "Thông tư 18/2019/TT-BTC bãi bỏ toàn bộ Thông tư 134/2014/TT-BTC",
  );
  assert.equal(rejected, false);
});

test("enterprise questions reject sources limited to household businesses", () => {
  const rejected = disqualifyTaxSource(
    "Doanh nghiệp phải khai thuế GTGT như thế nào?",
    "Thông tư quy định riêng về hộ kinh doanh và cá nhân kinh doanh",
  );
  assert.equal(rejected, true);
});
