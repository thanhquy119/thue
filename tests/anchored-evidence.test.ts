import assert from "node:assert/strict";
import test from "node:test";
import { buildAnchoredEvidence } from "../lib/legal/anchored-evidence.ts";
import type { DocumentDetail, ProvisionDetail } from "../lib/legal/types.ts";

function provision(
  id: string,
  identifier: string,
  officialText: string,
  orderIndex: number,
): ProvisionDetail {
  return {
    id,
    type: identifier.startsWith("Điều") ? "article" : "other",
    identifier,
    article: identifier.startsWith("Điều") ? identifier.replace("Điều ", "") : null,
    heading: null,
    official_text: officialText,
    order_index: orderIndex,
  };
}

function documentWith(provisions: ProvisionDetail[]): DocumentDetail {
  return {
    id: "89-2026-tt-btc",
    number: "89/2026/TT-BTC",
    title: "Quy định chi tiết một số điều của Luật Quản lý thuế",
    type: "Thông tư",
    issuer: "Bộ Tài chính",
    issued_date: "2026-06-30",
    effective_date: "2026-07-01",
    status: "effective",
    source_url: "https://example.test/89",
    source_label: "Nguồn kiểm thử",
    last_verified_at: new Date(0).toISOString(),
    extraction_method: "docx+doc",
    quality_score: 1,
    verification_notes: null,
    official_text: provisions.map((item) => item.official_text).join("\n\n"),
    provisions,
  };
}

test("retrieves field rows buried deep inside a long appendix", () => {
  const filler = Array.from(
    { length: 220 },
    (_, index) => `Dòng biểu mẫu không liên quan số ${index + 100}: thông tin kê khai chung và hướng dẫn hồ sơ.`,
  );
  const appendix = [
    "Mẫu số 01/GTGT - TỜ KHAI THUẾ GIÁ TRỊ GIA TĂNG (phương pháp khấu trừ)",
    ...filler,
    "Chỉ tiêu [37] - Điều chỉnh giảm số thuế GTGT còn được khấu trừ của các kỳ trước.",
    "Chỉ tiêu [38] - Điều chỉnh tăng số thuế GTGT còn được khấu trừ của các kỳ trước.",
    "Số liệu điều chỉnh phải căn cứ hồ sơ và kết quả xử lý theo quy định.",
  ].join("\n");
  const document = documentWith([
    provision("article-37", "Điều 37", "Quy định về nộp thuế và chứng từ nộp ngân sách nhà nước.", 3700),
    provision("appendix", "Phụ lục", appendix, 10_200),
  ]);

  const evidence = buildAnchoredEvidence(
    "Hướng dẫn kê khai chỉ tiêu 37, 38 trên tờ khai khấu trừ theo Thông tư 89/2026/TT-BTC",
    [document],
  );
  const combined = evidence[0]?.excerpts.join("\n") ?? "";

  assert.match(combined, /Chỉ tiêu \[37\].*Điều chỉnh giảm/iu);
  assert.match(combined, /Chỉ tiêu \[38\].*Điều chỉnh tăng/iu);
  assert.ok(evidence[0]?.excerpts.some((excerpt) => /Phụ lục — đoạn/iu.test(excerpt)));
});

test("field markers outrank articles that merely share the same numbers", () => {
  const document = documentWith([
    provision("article-37", "Điều 37", "Thời hạn nộp hồ sơ và trách nhiệm của cơ quan thuế.", 3700),
    provision("article-38", "Điều 38", "Tiếp nhận chứng từ và xử lý dữ liệu điện tử.", 3800),
    provision(
      "appendix",
      "Phụ lục",
      [
        "Mẫu số 01/GTGT - Tờ khai thuế GTGT theo phương pháp khấu trừ",
        "| Mã chỉ tiêu | Nội dung |",
        "| [37] | Điều chỉnh giảm số thuế GTGT còn được khấu trừ của các kỳ trước |",
        "| [38] | Điều chỉnh tăng số thuế GTGT còn được khấu trừ của các kỳ trước |",
      ].join("\n"),
      10_000,
    ),
  ]);

  const excerpts = buildAnchoredEvidence(
    "Chỉ tiêu 37 và 38 trên tờ khai khấu trừ theo Thông tư 89/2026",
    [document],
  )[0]?.excerpts ?? [];

  assert.match(excerpts[0] ?? "", /\[37\]|\[38\]/u);
  assert.doesNotMatch(excerpts[0] ?? "", /^Điều 37/u);
});

test("keeps nearby form instructions around an exact field match", () => {
  const lines = [
    "Mẫu số 02/KHBS - Bản giải trình khai bổ sung",
    ...Array.from({ length: 80 }, (_, index) => `Dòng hướng dẫn ${index + 1}.`),
    "Khoản điều chỉnh làm giảm số thuế còn được khấu trừ thì ghi vào chỉ tiêu [37].",
    "Khoản điều chỉnh làm tăng số thuế còn được khấu trừ thì ghi vào chỉ tiêu [38].",
    "Người nộp thuế lưu tài liệu giải trình và chứng từ liên quan.",
  ];
  const document = documentWith([provision("appendix", "Phụ lục", lines.join("\n"), 10_000)]);
  const combined = buildAnchoredEvidence("Kê khai chỉ tiêu 37 38 theo Thông tư 89/2026", [document])[0]?.excerpts.join("\n") ?? "";

  assert.match(combined, /làm giảm số thuế/iu);
  assert.match(combined, /làm tăng số thuế/iu);
  assert.match(combined, /lưu tài liệu giải trình|chứng từ liên quan/iu);
});
