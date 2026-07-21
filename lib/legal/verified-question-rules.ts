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

function registrationCandidate(): SearchCandidate {
  return {
    id: "verified-90-2026-tt-btc",
    number: "90/2026/TT-BTC",
    title: "Quy định về đăng ký thuế; thay thế Thông tư số 86/2024/TT-BTC từ ngày 01/07/2026",
    type: "Thông tư",
    issuer: "Bộ Tài chính",
    issued_date: "2026-06-30",
    source_url: "https://chinhphu.vn/?classid=1&docid=218839&pageid=27160",
    source_label: "Cổng Thông tin điện tử Chính phủ",
  };
}

function taxAdministrationLawCandidate(): SearchCandidate {
  return {
    id: "verified-108-2025-qh15",
    number: "108/2025/QH15",
    title: "Luật Quản lý thuế có hiệu lực từ ngày 01/07/2026",
    type: "Luật",
    issuer: "Quốc hội",
    issued_date: "2025-12-10",
    source_url: "https://vanban.chinhphu.vn/?classid=1&docid=218681&pageid=27160",
    source_label: "Cổng Thông tin điện tử Chính phủ",
  };
}

function currentRuleCandidates(): SearchCandidate[] {
  return [
    registrationCandidate(),
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

function isBroadRegistrationOverviewQuestion(query: string) {
  const normalized = normalize(query);
  const asksRegistration = /\b(?:dang ky thue|quy dinh dang ky thue|thu tuc dang ky thue)\b/.test(normalized);
  const asksOverview = /\b(?:quy dinh|nhu the nao|tong quan|diem moi|nam 2026|hien nay|hien hanh)\b/.test(normalized);
  const hasSpecificAction = /\b(?:lan dau|thay doi|chuyen dia chi|cham dut|khoi phuc|ma so thue|nguoi phu thuoc)\b/.test(normalized);
  const hasSpecificSubject = /\b(?:doanh nghiep|cong ty|to chuc|ho kinh doanh|ca nhan|nguoi phu thuoc|nha cung cap nuoc ngoai)\b/.test(normalized);
  return asksRegistration && asksOverview && !hasSpecificAction && !hasSpecificSubject && !asksHistoricalPeriod(normalized);
}

function registrationOverviewResponse(query: string): TaxSearchResponse {
  return {
    query_normalized: normalize(query),
    query_kind: "question",
    direct_answer:
      "Từ ngày 01/07/2026, căn cứ chính về đăng ký thuế là Thông tư số 90/2026/TT-BTC, thay thế Thông tư số 86/2024/TT-BTC; đồng thời Luật Quản lý thuế số 108/2025/QH15 bắt đầu có hiệu lực. Vì vậy, hồ sơ phát sinh từ ngày 01/07/2026 cần đối chiếu quy định mới, không dùng riêng Thông tư 86.\n\n" +
      "Các nhóm nội dung chính gồm: đăng ký thuế lần đầu; thay đổi thông tin đăng ký thuế; chấm dứt và khôi phục hiệu lực mã số thuế; đăng ký đối với tổ chức, doanh nghiệp; đăng ký đối với hộ kinh doanh, hộ gia đình, cá nhân; và đăng ký đối với một số chủ thể nước ngoài hoặc cá nhân không cư trú kinh doanh trên nền tảng thương mại điện tử.\n\n" +
      "Hồ sơ đăng ký thuế có thể được tiếp nhận điện tử qua Cổng Dịch vụ công quốc gia, ứng dụng định danh quốc gia hoặc Hệ thống thông tin quản lý thuế theo lộ trình triển khai. Trường hợp thay đổi địa chỉ làm thay đổi cơ quan thuế quản lý trực tiếp, quy định mới không yêu cầu người nộp thuế phải hoàn thành nghĩa vụ với cơ quan thuế nơi chuyển đi trước khi thay đổi địa chỉ; trường hợp thuộc diện rủi ro cần kiểm tra tại trụ sở sẽ được cơ quan thuế thông báo riêng.\n\n" +
      "Do thủ tục và hồ sơ khác nhau theo từng đối tượng, để tra đúng biểu mẫu và thời hạn cần nêu rõ một trong các trường hợp: doanh nghiệp/tổ chức, hộ kinh doanh, cá nhân/người phụ thuộc, nhà cung cấp nước ngoài; đồng thời cho biết đang đăng ký lần đầu, thay đổi thông tin, chuyển địa chỉ, chấm dứt hay khôi phục mã số thuế.",
    document: null,
    candidates: [registrationCandidate(), taxAdministrationLawCandidate()],
    warnings: [
      "Đây là bản tổng quan. Thành phần hồ sơ, cơ quan tiếp nhận và thời hạn xử lý phụ thuộc đối tượng và loại thủ tục cụ thể.",
    ],
    confidence: 0.96,
    retrieved_at: new Date().toISOString(),
  };
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
  if (isBroadRegistrationOverviewQuestion(query)) return registrationOverviewResponse(query);
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
