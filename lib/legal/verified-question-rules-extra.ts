import type { SearchCandidate, TaxSearchResponse } from "./types";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9%/_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function officialCandidate(
  id: string,
  number: string,
  title: string,
  type: string,
  issuer: string,
  issuedDate: string,
  sourceUrl: string,
): SearchCandidate {
  return {
    id,
    number,
    title,
    type,
    issuer,
    issued_date: issuedDate,
    source_url: sourceUrl,
    source_label: "Cổng Thông tin điện tử Chính phủ",
  };
}

function invoiceDecreeCandidate() {
  return officialCandidate(
    "verified-extra-254-2026-nd-cp",
    "254/2026/NĐ-CP",
    "Quy định về hóa đơn điện tử, chứng từ điện tử, có hiệu lực từ ngày 01/07/2026",
    "Nghị định",
    "Chính phủ",
    "2026-06-30",
    "https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-dinh-so-254-2026-nd-cp-ve-hoa-don-dien-tu-chung-tu-dien-tu-119260713164251972.htm",
  );
}

function invoiceCircularCandidate() {
  return officialCandidate(
    "verified-extra-91-2026-tt-btc",
    "91/2026/TT-BTC",
    "Hướng dẫn về hóa đơn điện tử, chứng từ điện tử",
    "Thông tư",
    "Bộ Tài chính",
    "2026-06-30",
    "https://xaydungchinhsach.chinhphu.vn/nhung-diem-moi-cua-nghi-dinh-254-2026-nd-cp-va-thong-tu-91-2026-tt-btc-ve-hoa-don-dien-tu-chung-tu-dien-tu-119260717143502375.htm",
  );
}

function thresholdCandidate() {
  return officialCandidate(
    "verified-extra-141-2026-nd-cp",
    "141/2026/NĐ-CP",
    "Chính sách thuế và hóa đơn điện tử đối với hộ kinh doanh, cá nhân kinh doanh",
    "Nghị định",
    "Chính phủ",
    "2026-04-29",
    "https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-dinh-so-141-2026-nd-cp-nang-nguong-doanh-thu-khong-phai-chiu-thue-len-1-ty-dong-119260504154326455.htm",
  );
}

function answer(query: string, directAnswer: string, candidates: SearchCandidate[]): TaxSearchResponse {
  return {
    query_normalized: normalize(query),
    query_kind: "question",
    direct_answer: directAnswer,
    document: null,
    candidates,
    warnings: [],
    confidence: 0.98,
    retrieved_at: new Date().toISOString(),
  };
}

function revenueInVnd(query: string) {
  const raw = query
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/,/g, ".");
  const match = raw.match(/(\d+(?:\.\d+)?)\s*(trieu|ty)\b/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value * (match[2] === "ty" ? 1_000_000_000 : 1_000_000) : null;
}

export function verifiedExtraQuestionResponse(query: string): TaxSearchResponse | null {
  const normalized = normalize(query);
  const years = normalized.match(/\b20\d{2}\b/g) ?? [];
  if (years.some((year) => Number(year) <= 2025)) return null;

  if (
    /\b(?:ho kinh doanh|ca nhan kinh doanh)\b/.test(normalized) &&
    /\bmay tinh tien\b/.test(normalized) &&
    /\b(?:bat buoc|co phai|phai dung)\b/.test(normalized)
  ) {
    const revenue = revenueInVnd(query);
    if (revenue !== null && revenue <= 1_000_000_000) {
      return answer(
        query,
        "Không. Hộ kinh doanh/cá nhân kinh doanh có doanh thu năm từ 01 tỷ đồng trở xuống không thuộc diện bắt buộc sử dụng hóa đơn điện tử theo ngưỡng doanh thu; nếu có nhu cầu và đáp ứng điều kiện thì có thể đăng ký sử dụng. Việc có phải lập hóa đơn trong một giao dịch cụ thể còn phụ thuộc loại hoạt động và trường hợp tại Nghị định số 254/2026/NĐ-CP.",
        [thresholdCandidate(), invoiceDecreeCandidate()],
      );
    }

    return answer(
      query,
      "Không nhất thiết phải dùng riêng hóa đơn điện tử khởi tạo từ máy tính tiền. Hộ kinh doanh/cá nhân kinh doanh có doanh thu năm trên 01 tỷ đồng phải áp dụng hóa đơn điện tử có mã của cơ quan thuế hoặc hóa đơn điện tử khởi tạo từ máy tính tiền có kết nối dữ liệu với cơ quan thuế theo Nghị định số 141/2026/NĐ-CP.\n\nNếu đã đăng ký sử dụng hóa đơn điện tử có mã hoặc không có mã phù hợp thì Nghị định số 254/2026/NĐ-CP không bắt buộc đăng ký thêm hóa đơn khởi tạo từ máy tính tiền.",
      [thresholdCandidate(), invoiceDecreeCandidate(), invoiceCircularCandidate()],
    );
  }

  const reportsMissingInvoice =
    /\b(?:to giac|phan anh|bao tin)\b/.test(normalized) &&
    /\bkhong\s+(?:lap|giao)(?:\s+va\s+(?:lap|giao))?\s+hoa don\b/.test(normalized);
  if (reportsMissingInvoice) {
    return answer(
      query,
      "Có thể được xem xét khen thưởng. Theo Nghị định số 254/2026/NĐ-CP và Thông tư số 91/2026/TT-BTC, người tiêu dùng phải cung cấp thông tin trung thực, chính xác, kịp thời; nội dung phản ánh phải đủ căn cứ để cơ quan thuế kiểm tra, xác minh và trên cơ sở đó ban hành quyết định xử phạt vi phạm hành chính về thuế, hóa đơn.\n\nViệc gửi phản ánh không tự động làm phát sinh tiền thưởng; phải đáp ứng điều kiện và trình tự khen thưởng theo quy định.",
      [invoiceDecreeCandidate(), invoiceCircularCandidate()],
    );
  }

  return null;
}
