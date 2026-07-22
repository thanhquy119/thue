import assert from "node:assert/strict";
import test from "node:test";
import { OCR_FORMAT_FIXTURES } from "../lib/legal/ocr-format-fixtures.ts";
import {
  auditOcrMainLayout,
  buildOcrMainProvisions,
  ocrBlockText,
} from "../lib/legal/ocr-main-layout.ts";

function fixture(id: string) {
  const value = OCR_FORMAT_FIXTURES.find((item) => item.id === id);
  assert.ok(value, `Missing fixture ${id}`);
  return value;
}

test("repairs a split ministry preamble and recognizes every main role", () => {
  const source = fixture("split-ministry-preamble");
  const provisions = buildOcrMainProvisions(source.pages);
  const preamble = provisions[0];
  assert.equal(preamble?.key, "preamble");
  const roles = new Map(preamble?.entries.map((entry) => [entry.preambleRole, ocrBlockText(entry.block)]));
  assert.match(roles.get("preamble-authority") ?? "", /BỘ TÀI CHÍNH/u);
  assert.match(roles.get("preamble-national") ?? "", /CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM/u);
  assert.match(roles.get("preamble-motto") ?? "", /Độc lập.*Tự do.*Hạnh phúc/u);
  assert.match(roles.get("preamble-number") ?? "", /Số.*88\/2026\/TT-BTC/u);
  assert.match(roles.get("preamble-dateline") ?? "", /Đà Nẵng.*15 tháng 6 năm 2026/u);
  assert.equal(roles.get("preamble-type"), "THÔNG TƯ");
  assert.match(roles.get("preamble-title") ?? "", /Hướng dẫn quản lý.*hộ kinh doanh/u);
});

test("collapses a multi-line document title into one main-layout title block", () => {
  const source = fixture("standard-decree");
  const provisions = buildOcrMainProvisions(source.pages);
  const titleEntries = provisions[0]?.entries.filter((entry) => entry.preambleRole === "preamble-title") ?? [];
  assert.equal(titleEntries.length, 1);
  assert.match(ocrBlockText(titleEntries[0]!.block), /Sửa đổi, bổ sung.*cá nhân kinh doanh/u);
  assert.ok(provisions.some((provision) => /^Điều 1\./u.test(provision.title)));
  assert.ok(provisions.some((provision) => /^Điều 2\./u.test(provision.title)));
});

test("does not treat a selected middle page as the legal preamble", () => {
  const source = fixture("mid-document-selection");
  const provisions = buildOcrMainProvisions(source.pages);
  assert.equal(provisions[0]?.key, "continuation");
  assert.equal(provisions[0]?.title, "Nội dung tiếp theo · Trang 7");
  assert.ok(provisions.some((provision) => /^Điều 4\b/u.test(provision.title)));
  assert.ok(provisions.some((provision) => /^Điều 5\./u.test(provision.title)));
});

test("layout audit passes complete preambles and structurally consistent tables", () => {
  for (const id of ["standard-decree", "split-ministry-preamble", "continued-six-column-table", "forms-and-checkboxes", "mid-document-selection"]) {
    const source = fixture(id);
    const provisions = buildOcrMainProvisions(source.pages);
    const checks = auditOcrMainLayout(provisions, source.pages);
    const tableCheck = checks.find((check) => check.id === "tables");
    assert.ok(tableCheck);
    assert.equal(tableCheck.status, "pass", `${id}: ${tableCheck.detail}`);
    if (source.pages[0]?.page === 1) {
      const preamble = checks.find((check) => check.id === "preamble");
      assert.ok(preamble);
      assert.equal(preamble.status, "pass", `${id}: ${preamble.detail}`);
    }
  }
});

test("layout audit keeps unreadable OCR regions as a manual warning", () => {
  const pages = [{ page: 7, text: "Điều 3. Nội dung\n1. Phần chữ [không đọc rõ] cần đối chiếu." }];
  const provisions = buildOcrMainProvisions(pages);
  const check = auditOcrMainLayout(provisions, pages).find((item) => item.id === "unclear");
  assert.equal(check?.status, "warn");
  assert.match(check?.detail ?? "", /1 vị trí/u);
});
