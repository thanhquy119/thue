import assert from "node:assert/strict";
import { searchTaxLawRobust } from "../lib/legal/robust-search.ts";
import type { TaxSearchResponse } from "../lib/legal/types.ts";

const COMMIT_MARKER = "[live-business]";
const enabled = process.env.RUN_LIVE_BUSINESS_QUESTIONS === "true" ||
  (process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "").includes(COMMIT_MARKER);

type BusinessCase = {
  query: string;
  expected: RegExp;
  sourceNumber: string;
};

const CASES: BusinessCase[] = [
  {
    query: "Doanh nghiệp chuyển địa chỉ trụ sở sang tỉnh khác có phải hoàn thành nghĩa vụ thuế tại nơi chuyển đi trước không?",
    expected: /khong|dia chi|nghia vu thue/u,
    sourceNumber: "90/2026/TT-BTC",
  },
  {
    query: "Nhà cung cấp nước ngoài kinh doanh trên nền tảng thương mại điện tử có phải đăng ký thuế tại Việt Nam không?",
    expected: /dang ky thue|nha cung cap nuoc ngoai|viet nam/u,
    sourceNumber: "252/2026/NĐ-CP",
  },
  {
    query: "Tôi cho thuê nhà doanh thu 100 triệu đồng một năm có phải đăng ký thuế và nộp thuế không?",
    expected: /dang ky thue|01 ty dong|khong phai nop thue/u,
    sourceNumber: "141/2026/NĐ-CP",
  },
  {
    query: "Cá nhân cho thuê bất động sản có phải sử dụng hóa đơn điện tử không?",
    expected: /khong|hoa don dien tu|cho thue bat dong san/u,
    sourceNumber: "254/2026/NĐ-CP",
  },
  {
    query: "Nhận tiền đặt cọc để bảo đảm thực hiện hợp đồng dịch vụ có phải lập hóa đơn ngay không?",
    expected: /khong|dat coc|bao dam/u,
    sourceNumber: "254/2026/NĐ-CP",
  },
  {
    query: "Hóa đơn điện tử có bắt buộc phải có chữ ký số của người mua không?",
    expected: /khong|chu ky so|nguoi mua/u,
    sourceNumber: "254/2026/NĐ-CP",
  },
  {
    query: "Đã đăng ký hóa đơn điện tử có mã thì có bắt buộc đăng ký thêm hóa đơn khởi tạo từ máy tính tiền không?",
    expected: /khong|may tinh tien|dang ky them/u,
    sourceNumber: "254/2026/NĐ-CP",
  },
  {
    query: "Bán hàng trong ca đêm mà không có phần mềm lập hóa đơn tự động thì có được lập vào ngày làm việc tiếp theo không?",
    expected: /co|ca dem|ngay lam viec tiep theo/u,
    sourceNumber: "254/2026/NĐ-CP",
  },
  {
    query: "Người tiêu dùng tố giác cửa hàng không lập hóa đơn thì có chắc chắn được thưởng không?",
    expected: /khen thuong|khong tu dong|xac minh/u,
    sourceNumber: "254/2026/NĐ-CP",
  },
  {
    query: "Cá nhân có nợ thuế thì có tự động bị tạm hoãn xuất cảnh không?",
    expected: /tam hoan xuat canh|khong phai moi|no thue/u,
    sourceNumber: "108/2025/QH15",
  },
];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/\s+/g, " ")
    .trim();
}

function summarize(result: TaxSearchResponse) {
  return {
    answer: result.direct_answer.slice(0, 700),
    confidence: result.confidence,
    document: result.document?.number ?? null,
    candidates: result.candidates.map((candidate) => candidate.number),
    warnings: result.warnings,
  };
}

async function main() {
  if (!enabled) {
    console.log(`[live-business] skipped; add ${COMMIT_MARKER} to the commit message or set RUN_LIVE_BUSINESS_QUESTIONS=true.`);
    return;
  }

  console.log(`[live-business] starting ${CASES.length} diverse business questions`);
  for (const businessCase of CASES) {
    const result = await searchTaxLawRobust(businessCase.query);
    const answer = normalize(result.direct_answer);
    const sourceNumbers = [
      result.document?.number,
      ...result.candidates.map((candidate) => candidate.number),
    ].filter(Boolean);

    assert.equal(result.query_kind, "question", businessCase.query);
    assert.ok(result.direct_answer.length >= 100, `Câu trả lời quá ngắn: ${businessCase.query}`);
    assert.ok(result.confidence >= 0.85, `Độ tin cậy thấp: ${businessCase.query}`);
    assert.match(answer, businessCase.expected, businessCase.query);
    assert.ok(sourceNumbers.includes(businessCase.sourceNumber), `Thiếu căn cứ ${businessCase.sourceNumber}: ${businessCase.query}`);
    assert.doesNotMatch(answer, /van ban gan giong|prompt|system message|khong the truy cap internet/u);
    console.log("[live-business-case]", JSON.stringify({ query: businessCase.query, ...summarize(result) }));
  }
  console.log("[live-business] diverse business question matrix passed");
}

main().catch((error) => {
  console.error("[live-business] failed", error);
  process.exitCode = 1;
});
