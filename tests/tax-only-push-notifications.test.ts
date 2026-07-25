import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyTaxDocumentForNotification,
  extractExplicitLegalRelations,
  publishedDocumentPayload,
  shouldNotifyPublishedDocument,
  type PublishedDocumentNotification,
} from "../lib/notifications/push-core.ts";

function notification(patch: Partial<PublishedDocumentNotification> = {}): PublishedDocumentNotification {
  return {
    revisionId: "b".repeat(64),
    number: "90/2026/TT-BTC",
    title: "Quy định về đăng ký thuế",
    issuedDate: "2026-07-01",
    publishedAt: "2026-07-25T08:00:00.000Z",
    accepted: true,
    documentType: "Thông tư",
    issuer: "Bộ Tài chính",
    officialText: "Người nộp thuế thực hiện đăng ký thuế và được cấp mã số thuế theo quy định.",
    ...patch,
  };
}

const CURRENT_TAX_DOCUMENTS = [
  ["108/2025/QH15", "Luật Quản lý thuế"],
  ["252/2026/NĐ-CP", "Quy định chi tiết một số điều và biện pháp để tổ chức, hướng dẫn thi hành Luật Quản lý thuế"],
  ["253/2026/NĐ-CP", "Quy định chi tiết một số điều của Luật Thuế thu nhập cá nhân"],
  ["254/2026/NĐ-CP", "Quy định về hóa đơn điện tử, chứng từ điện tử theo Luật Quản lý thuế"],
  ["90/2026/TT-BTC", "Quy định về đăng ký thuế"],
  ["91/2026/TT-BTC", "Quy định về hóa đơn điện tử, chứng từ điện tử"],
] as const;

const TAX_TOPIC_TITLES = [
  "Hướng dẫn thuế giá trị gia tăng",
  "Hướng dẫn thuế thu nhập doanh nghiệp",
  "Hướng dẫn thuế thu nhập cá nhân",
  "Quy định về thuế tiêu thụ đặc biệt",
  "Biểu thuế bảo vệ môi trường",
  "Biểu thuế xuất khẩu, biểu thuế nhập khẩu ưu đãi",
  "Quy định về hoàn thuế và khấu trừ thuế",
  "Quy định về lệ phí môn bài",
  "Quản lý nợ thuế và cưỡng chế thuế",
] as const;

const NON_TAX_DOCUMENTS = [
  ["256/2026/NĐ-CP", "Quy định về phù hiệu, cấp hiệu, trang phục và biển hiệu của công chức thuế"],
  ["01/2026/QĐ-BTC", "Quy định chức năng, nhiệm vụ, quyền hạn và cơ cấu tổ chức của Cục Thuế"],
  ["02/2026/TT-BTC", "Hướng dẫn chế độ kế toán doanh nghiệp"],
  ["03/2026/TT-BTC", "Quy định quản lý ngân sách nhà nước"],
  ["04/2026/TT-BTC", "Hướng dẫn quản lý tài sản công"],
  ["05/2026/TT-BTC", "Quy định mức thu phí và lệ phí trong lĩnh vực xây dựng"],
  ["06/2026/TT-BTC", "Quy định thủ tục hải quan đối với hàng hóa xuất khẩu, nhập khẩu"],
  ["07/2026/TT-BTC", "Hướng dẫn hoạt động chứng khoán và thị trường chứng khoán"],
  ["08/2026/NĐ-CP", "Quy định về đăng ký doanh nghiệp"],
  ["09/2026/QĐ-BTC", "Quy định thi đua, khen thưởng đối với công chức ngành Thuế"],
] as const;

test("accepts the current tax-document matrix and common tax topics", () => {
  for (const [number, title] of CURRENT_TAX_DOCUMENTS) {
    const result = classifyTaxDocumentForNotification(notification({ number, title }));
    assert.equal(result.eligible, true, `${number}: ${result.reason}`);
  }
  for (const title of TAX_TOPIC_TITLES) {
    const result = classifyTaxDocumentForNotification(notification({ title }));
    assert.equal(result.eligible, true, `${title}: ${result.reason}`);
  }
});

test("rejects internal tax-sector administration and non-tax finance documents", () => {
  for (const [number, title] of NON_TAX_DOCUMENTS) {
    const result = classifyTaxDocumentForNotification(notification({
      number,
      title,
      officialText: "Văn bản có nhắc đến Bộ Tài chính, cơ quan thuế và người nộp thuế trong phần căn cứ.",
    }));
    assert.equal(result.eligible, false, `${number} was classified as ${result.reason}`);
  }
});

test("uses multiple official-text signals only when a neutral legal title lacks tax words", () => {
  const accepted = classifyTaxDocumentForNotification(notification({
    title: "Quy định chi tiết một số điều của Luật số 108/2025/QH15",
    documentType: "Nghị định",
    officialText: "Người nộp thuế thực hiện khai thuế, nộp thuế tại cơ quan thuế quản lý trực tiếp.",
  }));
  assert.equal(accepted.eligible, true);
  assert.equal(accepted.reason, "tax_content");

  const rejected = classifyTaxDocumentForNotification(notification({
    title: "Quy định chi tiết một số điều của Luật số 01/2025/QH15",
    documentType: "Nghị định",
    officialText: "Kinh phí thực hiện được hạch toán; hồ sơ có thể sử dụng mã số thuế để đối chiếu.",
  }));
  assert.equal(rejected.eligible, false);
  assert.equal(rejected.reason, "insufficient_tax_evidence");
});

test("hard notification eligibility rejects non-tax documents even when accepted and recent", () => {
  const now = Date.parse("2026-07-25T12:00:00.000Z");
  assert.equal(shouldNotifyPublishedDocument(notification(), now, 60), true);
  assert.equal(shouldNotifyPublishedDocument(notification({
    number: "256/2026/NĐ-CP",
    title: "Quy định về trang phục và phù hiệu của công chức thuế",
  }), now, 60), false);
  assert.equal(shouldNotifyPublishedDocument(notification({
    title: "Hướng dẫn chế độ kế toán doanh nghiệp",
    officialText: "Văn bản có một dẫn chiếu tới nghĩa vụ thuế.",
  }), now, 60), false);
});

test("extracts only explicit replacement, amendment and repeal relations", () => {
  const relations = extractExplicitLegalRelations(notification({
    number: "100/2026/TT-BTC",
    title: "Thông tư sửa đổi, bổ sung một số điều của Thông tư số 80/2021/TT-BTC",
    officialText: [
      "Thông tư này thay thế Thông tư số 105/2020/TT-BTC ngày 03 tháng 12 năm 2020.",
      "Bãi bỏ Quyết định số 15/2019/QĐ-BTC kể từ ngày Thông tư này có hiệu lực.",
      "Luật số 01/2020/QH14 đã được sửa đổi, bổ sung bởi Luật số 02/2022/QH15.",
    ].join("\n"),
  }));
  assert.deepEqual(relations, [
    { kind: "replaces", targets: ["105/2020/TT-BTC"] },
    { kind: "amends", targets: ["80/2021/TT-BTC"] },
    { kind: "repeals", targets: ["15/2019/QĐ-BTC"] },
  ]);
  assert.equal(JSON.stringify(relations).includes("01/2020/QH14"), false);
  assert.equal(JSON.stringify(relations).includes("02/2022/QH15"), false);
});

test("keeps Push copy short and includes a verified legal relation when available", () => {
  const payload = publishedDocumentPayload(notification({
    number: "100/2026/TT-BTC",
    title: "Thông tư sửa đổi, bổ sung một số điều của Thông tư số 80/2021/TT-BTC",
  }));
  assert.equal(payload.title, "Văn bản thuế mới");
  assert.match(payload.body, /^100\/2026\/TT-BTC · Sửa đổi 80\/2021\/TT-BTC/u);
  assert.ok(payload.body.length <= 150);
});

test("does not invent a legal relation from historical citations", () => {
  const payload = publishedDocumentPayload(notification({
    title: "Quy định về đăng ký thuế",
    officialText: "Luật số 01/2020/QH14 đã được sửa đổi, bổ sung bởi Luật số 02/2022/QH15.",
  }));
  assert.equal(payload.title, "Văn bản thuế mới");
  assert.match(payload.body, /^90\/2026\/TT-BTC · Quy định về đăng ký thuế$/u);
});
