import assert from "node:assert/strict";
import test from "node:test";
import { prepareDocumentForPresentation } from "../lib/legal/document-presentation.ts";
import type { DocumentDetail } from "../lib/legal/types.ts";

function documentWithText(officialText: string): DocumentDetail {
  return {
    id: "circular-82",
    number: "82/2026/TT-BTC",
    title: "Quy định về kinh doanh hàng miễn thuế",
    type: "Thông tư",
    issuer: "Bộ Tài chính",
    issued_date: "2026-06-30",
    effective_date: "2026-07-01",
    status: "effective",
    source_url: "https://congbao.chinhphu.vn/example",
    source_label: "Công báo",
    last_verified_at: new Date(0).toISOString(),
    extraction_method: "docx",
    quality_score: 1,
    verification_notes: "Nguồn được nhập nền theo thứ tự kỹ thuật.",
    official_text: officialText,
    provisions: [
      {
        id: "circular-82-article-11",
        type: "article",
        identifier: "Điều 11",
        article: "11",
        heading: "Điều khoản chuyển tiếp",
        official_text: "Nội dung cũ đang dính phần ký và phụ lục.",
        order_index: 1100,
      },
    ],
  };
}

test("separates signature and appendix from the final article without changing official text", () => {
  const original = `BỘ TÀI CHÍNH\nSố: 82/2026/TT-BTC\nTHÔNG TƯ\nQuy định về kinh doanh hàng miễn thuế\n\nĐiều 10. Trách nhiệm thi hành\nCác đơn vị có trách nhiệm thi hành Thông tư này.\n\nĐiều 11. Điều khoản chuyển tiếp\n1. Doanh nghiệp tiếp tục hoạt động theo quy định.\n2. Việc thay đổi địa điểm thực hiện theo Thông tư này./. KT. BỘ TRƯỞNG\nTHỨ TRƯỞNG\nNguyễn Đức Chi\nPhụ lục (Kèm theo Thông tư số 82/2026/TT-BTC)\nMẫu số 01\nTÊN DOANH NGHIỆP`;
  const prepared = prepareDocumentForPresentation(documentWithText(original));

  assert.equal(prepared.official_text, original);
  assert.equal(prepared.verification_notes, null);

  const article11 = prepared.provisions.find((provision) => provision.identifier === "Điều 11");
  assert.ok(article11);
  assert.match(article11.official_text, /Việc thay đổi địa điểm/u);
  assert.match(article11.official_text, /\.\/\.$/u);
  assert.equal(article11.official_text.includes("KT. BỘ TRƯỞNG"), false);
  assert.equal(article11.official_text.includes("Mẫu số 01"), false);
  assert.equal(article11.id, "circular-82-article-11");

  const signature = prepared.provisions.find((provision) => provision.identifier === "Phần ký và nơi nhận");
  const appendix = prepared.provisions.find((provision) => provision.identifier === "Phụ lục");
  assert.match(signature?.official_text ?? "", /KT\. BỘ TRƯỞNG/u);
  assert.match(appendix?.official_text ?? "", /Mẫu số 01/u);
});

test("separates an appendix that starts on a new line even when no signature is present", () => {
  const prepared = prepareDocumentForPresentation(documentWithText(`THÔNG TƯ\nĐiều 1. Phạm vi\nNội dung chính.\n\nĐiều 2. Hiệu lực\nThông tư có hiệu lực từ ngày công bố.\nPHỤ LỤC I\nDANH MỤC BIỂU MẪU`));

  const article2 = prepared.provisions.find((provision) => provision.identifier === "Điều 2");
  assert.equal(article2?.official_text, "Thông tư có hiệu lực từ ngày công bố.");
  assert.match(
    prepared.provisions.find((provision) => provision.identifier === "Phụ lục")?.official_text ?? "",
    /DANH MỤC BIỂU MẪU/u,
  );
});
