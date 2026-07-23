import assert from "node:assert/strict";
import test from "node:test";
import {
  hasUsableLegalDocumentText,
  looksLikeGovernmentPortalShell,
  rejectPortalShellDocument,
} from "../lib/legal/document-quality.ts";
import type { TaxSearchResponse } from "../lib/legal/types.ts";

const portalShell = `
Thông tư số 90/2026/TT-BTC của Bộ Tài chính: Quy định về đăng ký thuế
English
中文
Trang chủ Chính phủ Công dân Doanh nghiệp Kiều bào Báo điện tử Chính phủ Văn phòng Chính phủ
Nước CHXHCN Việt Nam
Giới thiệu
Chính phủ
Thư điện tử công vụ Chính phủ
Hà Nội 26° - 28°
Lai Châu 22° - 24°
Điện Biên 23° - 25°
Tuyên Quang 24° - 26°
`;

const legalText = `
BỘ TÀI CHÍNH
Số: 90/2026/TT-BTC
THÔNG TƯ
QUY ĐỊNH VỀ ĐĂNG KÝ THUẾ

Điều 1. Phạm vi điều chỉnh
Thông tư này quy định về đăng ký thuế.

Điều 2. Đối tượng áp dụng
Người nộp thuế và cơ quan quản lý thuế thực hiện theo quy định.
`.repeat(8);

test("detects Government portal navigation and weather as page chrome", () => {
  assert.equal(looksLikeGovernmentPortalShell(portalShell), true);
  assert.equal(hasUsableLegalDocumentText(portalShell, "90/2026/TT-BTC"), false);
});

test("accepts structured legal text matching the requested document number", () => {
  assert.equal(looksLikeGovernmentPortalShell(legalText), false);
  assert.equal(hasUsableLegalDocumentText(legalText, "90/2026/TT-BTC"), true);
});

test("removes a portal shell document while preserving its source candidate", () => {
  const response: TaxSearchResponse = {
    query_normalized: "90/2026/tt-btc",
    query_kind: "document",
    direct_answer: "Đã tìm thấy.",
    document: {
      id: "doc-90",
      number: "90/2026/TT-BTC",
      title: "Quy định về đăng ký thuế",
      type: "Thông tư",
      issuer: "Bộ Tài chính",
      issued_date: "2026-06-30",
      effective_date: "2026-07-01",
      status: "effective",
      source_url: "https://chinhphu.vn/example",
      source_label: "Cổng Chính phủ",
      last_verified_at: new Date(0).toISOString(),
      extraction_method: "html",
      quality_score: 0.6,
      verification_notes: null,
      official_text: portalShell,
      provisions: [],
    },
    candidates: [],
    warnings: [],
    confidence: 0.9,
    retrieved_at: new Date(0).toISOString(),
  };

  const guarded = rejectPortalShellDocument(response);
  assert.equal(guarded.document, null);
  assert.equal(guarded.candidates?.[0]?.number, "90/2026/TT-BTC");
  assert.match(guarded.direct_answer, /đã chặn nội dung menu/i);
});
