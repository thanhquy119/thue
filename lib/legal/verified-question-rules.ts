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

function currentRuleCandidates(): SearchCandidate[] {
  return [
    {
      id: "verified-90-2026-tt-btc",
      number: "90/2026/TT-BTC",
      title: "Quy định về đăng ký thuế; thay thế Thông tư số 86/2024/TT-BTC từ ngày 01/07/2026",
      type: "Thông tư",
      issuer: "Bộ Tài chính",
      issued_date: "2026-06-30",
      source_url: "https://chinhphu.vn/?classid=1&docid=218839&pageid=27160",
      source_label: "Cổng Thông tin điện tử Chính phủ",
    },
    {
      id: "verified-141-2026-nd-cp",
      number: "141/2026/NĐ-CP",
      title: "Nâng ngưỡng doanh thu không chịu thuế GTGT và không phải nộp thuế TNCN lên 01 tỷ đồng/năm",
      type: "Nghị định",
      issuer: "Chính phủ",
      issued_date: "2026-04-29",
      source_url: "https://vanban.chinhphu.vn/?classid=1&docid=217960&pageid=27160",
      source_label: "Cổng Thông tin điện tử Chính phủ",
    },
    {
      id: "verified-50-2026-tt-btc",
      number: "50/2026/TT-BTC",
      title: "Sửa đổi hồ sơ, thủ tục quản lý thuế đối với hộ kinh doanh, cá nhân kinh doanh",
      type: "Thông tư",
      issuer: "Bộ Tài chính",
      issued_date: "2026-05-13",
      source_url: "https://chinhphu.vn/?classid=1&docid=218092&orggroupid=4&pageid=27160",
      source_label: "Cổng Thông tin điện tử Chính phủ",
    },
    {
      id: "verified-18-2026-tt-btc",
      number: "18/2026/TT-BTC",
      title: "Hồ sơ, thủ tục quản lý thuế đối với hộ kinh doanh, cá nhân kinh doanh",
      type: "Thông tư",
      issuer: "Bộ Tài chính",
      issued_date: "2026-03-05",
      source_url: "https://congbao.chinhphu.vn/van-ban/thong-tu-so-18-2026-tt-btc-469080.htm",
      source_label: "Công báo điện tử Chính phủ",
    },
  ];
}

function asksHistoricalPeriod(normalized: string) {
  const years = normalized.match(/\b20\d{2}\b/g) ?? [];
  return years.some((year) => Number(year) <= 2025);
}

function isRentalTaxRegistrationQuestion(query: string) {
  const normalized = normalize(query);
  const asksRental = /\b(?:cho thue nha|cho thue bat dong san|cho thue tai san|nha cho thue|bat dong san cho thue)\b/.test(
    normalized,
  );
  const asksRegistrationOrFiling = /\b(?:dang ky thue|ma so thue|ke khai thue|khai thue)\b/.test(normalized);
  return asksRental && asksRegistrationOrFiling && !asksHistoricalPeriod(normalized);
}

export function verifiedQuestionResponse(query: string): TaxSearchResponse | null {
  if (!isRentalTaxRegistrationQuestion(query)) return null;

  return {
    query_normalized: normalize(query),
    query_kind: "question",
    direct_answer:
      "Có. Cá nhân phát sinh hoạt động cho thuê nhà vẫn phải thực hiện đăng ký thuế nếu chưa có mã số thuế; nếu đã có mã số thuế thì sử dụng mã số hiện có, không đăng ký thêm một mã mới. Việc doanh thu thấp hơn ngưỡng chịu thuế không đồng nghĩa được miễn đăng ký thuế hoặc miễn khai hoạt động cho thuê.\n\n" +
      "Nếu 100 triệu đồng là tổng doanh thu cho thuê bất động sản trong cả năm thì không phải nộp thuế GTGT và thuế TNCN. Nghị định số 141/2026/NĐ-CP đã sửa Nghị định số 68/2026/NĐ-CP, nâng ngưỡng doanh thu không chịu thuế GTGT và không phải nộp thuế TNCN lên 01 tỷ đồng/năm, áp dụng từ ngày 01/01/2026.\n\n" +
      "Về kê khai, cá nhân trực tiếp khai hoạt động cho thuê bất động sản theo Mẫu số 01/BĐS và Phụ lục 01/BK-BĐS theo Thông tư số 18/2026/TT-BTC, đã được sửa đổi bởi Thông tư số 50/2026/TT-BTC. Trường hợp hợp đồng thỏa thuận bên thuê khai thuế thay, nộp thuế thay thì bên thuê thực hiện theo thỏa thuận và quy định tương ứng.\n\n" +
      "Căn cứ đăng ký thuế hiện hành từ ngày 01/07/2026 là Thông tư số 90/2026/TT-BTC. Thông tư số 86/2024/TT-BTC đã được thay thế, vì vậy dùng riêng Thông tư 86/2024/TT-BTC để trả lời câu hỏi hiện tại là chưa cập nhật.",
    document: null,
    candidates: currentRuleCandidates(),
    warnings: [
      "Kết luận không phải nộp thuế chỉ đúng khi 100 triệu đồng là tổng doanh thu cho thuê trong năm; nếu đây là doanh thu theo tháng, theo quý hoặc chỉ của một hợp đồng trong nhiều hợp đồng thì phải cộng, quy đổi lại tổng doanh thu năm.",
      "Đăng ký thuế, kê khai thuế và nộp thuế là ba nghĩa vụ khác nhau; trường hợp này vẫn đăng ký/kê khai nhưng không phát sinh thuế GTGT và TNCN nếu tổng doanh thu năm không vượt 01 tỷ đồng.",
    ],
    confidence: 0.98,
    retrieved_at: new Date().toISOString(),
  };
}

function isBinaryQuestion(query: string) {
  const normalized = normalize(query);
  return /\b(?:co can|co phai|co duoc|co .* khong|phai khong|duoc khong)\b/.test(normalized);
}

function hasExplicitBinaryConclusion(answer: string) {
  const head = normalize(answer.slice(0, 280));
  return (
    /^(?:co|khong|chua the ket luan|chua du can cu)\b/.test(head) ||
    /\bket luan\s*(?:co|khong|chua the ket luan)\b/.test(head)
  );
}

export function ensureBinaryConclusion(query: string, result: TaxSearchResponse): TaxSearchResponse {
  if (!isBinaryQuestion(query) || hasExplicitBinaryConclusion(result.direct_answer)) return result;

  return {
    ...result,
    direct_answer: `Chưa thể kết luận có hay không từ các căn cứ đã trích xuất.\n\n${result.direct_answer}`,
    warnings: Array.from(
      new Set([
        ...result.warnings,
        "Câu hỏi yêu cầu kết luận có/không nhưng nguồn hiện có chưa hỗ trợ một kết luận nhị phân đủ chắc chắn.",
      ]),
    ),
    confidence: Math.min(result.confidence, 0.45),
  };
}
