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

function candidate(
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

function registrationCandidate() {
  return candidate(
    "verified-90-2026-tt-btc",
    "90/2026/TT-BTC",
    "Quy định về đăng ký thuế; thay thế Thông tư số 86/2024/TT-BTC từ ngày 01/07/2026",
    "Thông tư",
    "Bộ Tài chính",
    "2026-06-30",
    "https://xaydungchinhsach.chinhphu.vn/mot-so-diem-moi-cua-thong-tu-90-2026-tt-btc-ve-dang-ky-thue-11926071714240164.htm",
  );
}

function taxAdministrationLawCandidate() {
  return candidate(
    "verified-108-2025-qh15",
    "108/2025/QH15",
    "Luật Quản lý thuế có hiệu lực từ ngày 01/07/2026",
    "Luật",
    "Quốc hội",
    "2025-12-10",
    "https://xaydungchinhsach.chinhphu.vn/toan-van-luat-quan-ly-thue-co-hieu-luc-tu-1-7-2026-119260626174633402.htm",
  );
}

function taxAdministrationDecreeCandidate() {
  return candidate(
    "verified-252-2026-nd-cp",
    "252/2026/NĐ-CP",
    "Quy định chi tiết và biện pháp tổ chức thi hành Luật Quản lý thuế",
    "Nghị định",
    "Chính phủ",
    "2026-06-30",
    "https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-dinh-252-2026-nd-cp-huong-dan-thi-hanh-luat-quan-ly-thue-119260715155021635.htm",
  );
}

function householdThresholdCandidate() {
  return candidate(
    "verified-141-2026-nd-cp",
    "141/2026/NĐ-CP",
    "Nâng ngưỡng doanh thu không chịu thuế GTGT và không phải nộp thuế TNCN lên 01 tỷ đồng/năm",
    "Nghị định",
    "Chính phủ",
    "2026-04-29",
    "https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-dinh-so-141-2026-nd-cp-nang-nguong-doanh-thu-khong-phai-chiu-thue-len-1-ty-dong-119260504154326455.htm",
  );
}

function householdProcedureCandidate() {
  return candidate(
    "verified-50-2026-tt-btc",
    "50/2026/TT-BTC",
    "Sửa đổi hồ sơ, thủ tục quản lý thuế đối với hộ kinh doanh, cá nhân kinh doanh",
    "Thông tư",
    "Bộ Tài chính",
    "2026-05-13",
    "https://xaydungchinhsach.chinhphu.vn/huong-dan-thu-tuc-khai-thue-doi-voi-ho-kinh-doanh-ca-nhan-kinh-doanh-119260530072620314.htm",
  );
}

function householdBaseProcedureCandidate() {
  return candidate(
    "verified-18-2026-tt-btc",
    "18/2026/TT-BTC",
    "Hồ sơ, thủ tục quản lý thuế đối với hộ kinh doanh, cá nhân kinh doanh",
    "Thông tư",
    "Bộ Tài chính",
    "2026-03-05",
    "https://congbao.chinhphu.vn/van-ban/thong-tu-so-18-2026-tt-btc-469080.htm",
  );
}

function invoiceDecreeCandidate() {
  return candidate(
    "verified-254-2026-nd-cp",
    "254/2026/NĐ-CP",
    "Quy định về hóa đơn điện tử, chứng từ điện tử, có hiệu lực từ ngày 01/07/2026",
    "Nghị định",
    "Chính phủ",
    "2026-06-30",
    "https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-dinh-so-254-2026-nd-cp-ve-hoa-don-dien-tu-chung-tu-dien-tu-119260713164251972.htm",
  );
}

function invoiceCircularCandidate() {
  return candidate(
    "verified-91-2026-tt-btc",
    "91/2026/TT-BTC",
    "Hướng dẫn Luật Quản lý thuế và Nghị định số 254/2026/NĐ-CP về hóa đơn điện tử, chứng từ điện tử",
    "Thông tư",
    "Bộ Tài chính",
    "2026-06-30",
    "https://xaydungchinhsach.chinhphu.vn/nhung-diem-moi-cua-nghi-dinh-254-2026-nd-cp-va-thong-tu-91-2026-tt-btc-ve-hoa-don-dien-tu-chung-tu-dien-tu-119260717143502375.htm",
  );
}

function corporateTaxCandidate() {
  return candidate(
    "verified-320-2025-nd-cp",
    "320/2025/NĐ-CP",
    "Quy định chi tiết và biện pháp thi hành Luật Thuế thu nhập doanh nghiệp",
    "Nghị định",
    "Chính phủ",
    "2025-12-15",
    "https://xaydungchinhsach.chinhphu.vn/nghi-dinh-so-141-2026-nd-cp-quy-dinh-moi-ve-chinh-sach-thue-doi-voi-ho-kinh-doanh-doanh-nghiep-119260430091642895.htm",
  );
}

function response(
  query: string,
  answer: string,
  candidates: SearchCandidate[],
  warnings: string[] = [],
  confidence = 0.97,
): TaxSearchResponse {
  return {
    query_normalized: normalize(query),
    query_kind: "question",
    direct_answer: answer,
    document: null,
    candidates,
    warnings,
    confidence,
    retrieved_at: new Date().toISOString(),
  };
}

function asksHistoricalPeriod(normalized: string) {
  const years = normalized.match(/\b20\d{2}\b/g) ?? [];
  return years.some((year) => Number(year) <= 2025);
}

function isBroadRegistrationOverviewQuestion(normalized: string) {
  const asksRegistration = /\b(?:dang ky thue|quy dinh dang ky thue|thu tuc dang ky thue)\b/.test(normalized);
  const asksOverview = /\b(?:quy dinh|nhu the nao|tong quan|diem moi|nam 2026|hien nay|hien hanh)\b/.test(normalized);
  const hasSpecificAction = /\b(?:lan dau|thay doi|chuyen dia chi|cham dut|khoi phuc|ma so thue|nguoi phu thuoc)\b/.test(normalized);
  const hasSpecificSubject = /\b(?:doanh nghiep|cong ty|to chuc|ho kinh doanh|ca nhan|nguoi phu thuoc|nha cung cap nuoc ngoai)\b/.test(normalized);
  return asksRegistration && asksOverview && !hasSpecificAction && !hasSpecificSubject;
}

function registrationOverviewResponse(query: string) {
  return response(
    query,
    "Từ ngày 01/07/2026, căn cứ chính về đăng ký thuế là Thông tư số 90/2026/TT-BTC, thay thế Thông tư số 86/2024/TT-BTC; đồng thời Luật Quản lý thuế số 108/2025/QH15 bắt đầu có hiệu lực. Vì vậy, hồ sơ phát sinh từ ngày 01/07/2026 cần đối chiếu quy định mới, không dùng riêng Thông tư 86.\n\n" +
      "Các nhóm nội dung chính gồm: đăng ký thuế lần đầu; thay đổi thông tin đăng ký thuế; chấm dứt và khôi phục hiệu lực mã số thuế; đăng ký đối với tổ chức, doanh nghiệp; đăng ký đối với hộ kinh doanh, hộ gia đình, cá nhân; và đăng ký đối với một số chủ thể nước ngoài hoặc cá nhân không cư trú kinh doanh trên nền tảng thương mại điện tử.\n\n" +
      "Hồ sơ đăng ký thuế có thể được tiếp nhận điện tử qua Cổng Dịch vụ công quốc gia, ứng dụng định danh quốc gia hoặc Hệ thống thông tin quản lý thuế theo lộ trình triển khai. Trường hợp thay đổi địa chỉ làm thay đổi cơ quan thuế quản lý trực tiếp, quy định mới không yêu cầu người nộp thuế phải hoàn thành nghĩa vụ với cơ quan thuế nơi chuyển đi trước khi thay đổi địa chỉ; trường hợp thuộc diện rủi ro cần kiểm tra tại trụ sở sẽ được cơ quan thuế thông báo riêng.\n\n" +
      "Do thủ tục và hồ sơ khác nhau theo từng đối tượng, để tra đúng biểu mẫu và thời hạn cần nêu rõ một trong các trường hợp: doanh nghiệp/tổ chức, hộ kinh doanh, cá nhân/người phụ thuộc, nhà cung cấp nước ngoài; đồng thời cho biết đang đăng ký lần đầu, thay đổi thông tin, chuyển địa chỉ, chấm dứt hay khôi phục mã số thuế.",
    [registrationCandidate(), taxAdministrationLawCandidate()],
    ["Đây là bản tổng quan. Thành phần hồ sơ, cơ quan tiếp nhận và thời hạn xử lý phụ thuộc đối tượng và loại thủ tục cụ thể."],
    0.96,
  );
}

function parseMoney(query: string) {
  const match = normalize(query).match(/(\d+(?:[.,]\d+)?)\s*(trieu|ty)\b/);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value)) return null;
  return value * (match[2] === "ty" ? 1_000_000_000 : 1_000_000);
}

function rentalRegistrationResponse(query: string) {
  return response(
    query,
    "Có. Cá nhân phát sinh hoạt động cho thuê nhà vẫn phải thực hiện đăng ký thuế nếu chưa có mã số thuế; nếu đã có mã số thuế thì sử dụng mã số hiện có, không đăng ký thêm một mã mới. Việc doanh thu thấp hơn ngưỡng chịu thuế không đồng nghĩa được miễn đăng ký thuế hoặc miễn khai hoạt động cho thuê.\n\n" +
      "Nếu 100 triệu đồng là tổng doanh thu cho thuê bất động sản trong cả năm thì không phải nộp thuế GTGT và thuế TNCN. Nghị định số 141/2026/NĐ-CP nâng ngưỡng doanh thu không chịu thuế GTGT và không phải nộp thuế TNCN lên 01 tỷ đồng/năm, áp dụng từ ngày 01/01/2026.\n\n" +
      "Về kê khai, cá nhân trực tiếp khai hoạt động cho thuê bất động sản theo hồ sơ tương ứng tại Thông tư số 18/2026/TT-BTC, đã được sửa đổi bởi Thông tư số 50/2026/TT-BTC. Căn cứ đăng ký thuế hiện hành từ ngày 01/07/2026 là Thông tư số 90/2026/TT-BTC; Thông tư số 86/2024/TT-BTC đã được thay thế.",
    [registrationCandidate(), householdThresholdCandidate(), householdProcedureCandidate(), householdBaseProcedureCandidate()],
    [
      "Kết luận không phải nộp thuế chỉ đúng khi số tiền nêu trong câu hỏi là tổng doanh thu cho thuê trong năm.",
      "Đăng ký thuế, kê khai thuế và nộp thuế là ba nghĩa vụ khác nhau.",
    ],
    0.98,
  );
}

export function verifiedQuestionResponse(query: string): TaxSearchResponse | null {
  const normalized = normalize(query);
  if (asksHistoricalPeriod(normalized)) return null;

  if (isBroadRegistrationOverviewQuestion(normalized)) return registrationOverviewResponse(query);

  if (/\b(?:chuyen|thay doi) dia chi\b/.test(normalized) && /\b(?:hoan thanh|nghia vu thue|noi chuyen di)\b/.test(normalized)) {
    return response(
      query,
      "Không. Từ ngày 01/07/2026, khi thay đổi địa chỉ trụ sở làm thay đổi cơ quan thuế quản lý trực tiếp, người nộp thuế không bị yêu cầu phải hoàn thành nghĩa vụ với cơ quan thuế nơi chuyển đi trước khi thực hiện thay đổi địa chỉ theo Thông tư số 90/2026/TT-BTC.\n\nTrường hợp người nộp thuế thuộc diện phải kiểm tra tại trụ sở khi chuyển địa điểm, cơ quan thuế sẽ thông báo riêng; đây không phải là điều kiện chung buộc mọi doanh nghiệp phải hoàn thành toàn bộ nghĩa vụ trước khi đổi địa chỉ.",
      [registrationCandidate()],
      ["Cần phân biệt thủ tục thay đổi địa chỉ đăng ký thuế với việc xử lý các khoản thuế còn nợ hoặc quyết định cưỡng chế đã phát sinh."],
    );
  }

  if (/\b(?:to chuc nuoc ngoai|nha cung cap nuoc ngoai)\b/.test(normalized) && /\b(?:thuong mai dien tu|nen tang)\b/.test(normalized) && /\bdang ky thue\b/.test(normalized)) {
    return response(
      query,
      "Có, nếu tổ chức nước ngoài kinh doanh trên nền tảng thương mại điện tử hoặc cung cấp dịch vụ khác và có doanh thu tính thuế tại Việt Nam. Tổ chức thực hiện đăng ký giao dịch thuế điện tử cùng với đăng ký thuế lần đầu và được cấp mã số thuế qua Hệ thống thông tin quản lý thuế theo Nghị định số 252/2026/NĐ-CP và Thông tư số 90/2026/TT-BTC.\n\nNgoại lệ: nếu nghĩa vụ thuế đối với toàn bộ doanh thu tại Việt Nam đã được tổ chức kinh doanh tại Việt Nam hoặc chủ quản nền tảng thực hiện khấu trừ và nộp thay theo quy định thì nhà cung cấp nước ngoài không phải thực hiện thủ tục đăng ký thuế riêng cho phần nghĩa vụ đó.",
      [taxAdministrationDecreeCandidate(), registrationCandidate()],
    );
  }

  if (/\bho kinh doanh\b/.test(normalized) && /\bthay doi thong tin\b/.test(normalized) && /\bdang ky thue\b/.test(normalized)) {
    return response(
      query,
      "Từ ngày 01/07/2026, hộ kinh doanh thực hiện thay đổi thông tin đăng ký thuế theo nhóm thủ tục riêng dành cho hộ kinh doanh, hộ gia đình và cá nhân tại Thông tư số 90/2026/TT-BTC. Hồ sơ có thể được tiếp nhận điện tử hoặc qua cơ chế liên thông tùy thông tin thay đổi.\n\nNếu thay đổi địa chỉ làm thay đổi cơ quan thuế quản lý trực tiếp thì không phải hoàn thành nghĩa vụ với cơ quan thuế nơi chuyển đi trước khi đổi địa chỉ; trường hợp thuộc diện kiểm tra tại trụ sở, cơ quan thuế sẽ gửi thông báo riêng. Để xác định đúng mẫu và giấy tờ, cần nêu rõ thông tin muốn thay đổi là địa chỉ, tên, giấy tờ định danh, ngành nghề hay thông tin tài khoản.",
      [registrationCandidate()],
      ["Thành phần hồ sơ cụ thể phụ thuộc loại thông tin đăng ký thuế được thay đổi."],
      0.95,
    );
  }

  const asksRental = /\b(?:cho thue nha|cho thue bat dong san|cho thue tai san|nha cho thue|bat dong san cho thue)\b/.test(normalized);
  if (asksRental && /\b(?:dang ky thue|ma so thue|ke khai thue|khai thue)\b/.test(normalized)) {
    return rentalRegistrationResponse(query);
  }

  if (asksRental && /\bhoa don(?: dien tu)?\b/.test(normalized)) {
    return response(
      query,
      "Không. Theo Điều 7 Nghị định số 254/2026/NĐ-CP, hộ kinh doanh, cá nhân kinh doanh có thu nhập từ hoạt động cho thuê bất động sản thuộc trường hợp không phải sử dụng hóa đơn điện tử.\n\nQuy định này chỉ liên quan đến nghĩa vụ sử dụng hóa đơn điện tử; cá nhân vẫn phải thực hiện đăng ký thuế, khai doanh thu và xác định nghĩa vụ thuế theo quy định áp dụng cho hoạt động cho thuê bất động sản.",
      [invoiceDecreeCandidate(), householdProcedureCandidate()],
    );
  }

  if (/\bdat coc\b/.test(normalized) && /\b(?:hop dong|dich vu|hoa don)\b/.test(normalized)) {
    return response(
      query,
      "Không, nếu khoản tiền đặt cọc chỉ nhằm bảo đảm thực hiện hợp đồng cung cấp dịch vụ theo Bộ luật Dân sự. Nghị định số 254/2026/NĐ-CP quy định trường hợp này không phải lập hóa đơn tại thời điểm nhận đặt cọc.\n\nNếu khoản tiền mang bản chất là tiền ứng trước hoặc thanh toán trước cho dịch vụ, không chỉ là khoản bảo đảm, thì phải xác định thời điểm lập hóa đơn theo bản chất giao dịch và quy định về thời điểm lập hóa đơn.",
      [invoiceDecreeCandidate(), invoiceCircularCandidate()],
    );
  }

  if (/\bchu ky so\b/.test(normalized) && /\bnguoi mua\b/.test(normalized) && /\bhoa don\b/.test(normalized)) {
    return response(
      query,
      "Không. Trên hóa đơn điện tử không nhất thiết phải có chữ ký số của người mua theo Nghị định số 254/2026/NĐ-CP, trừ trường hợp người mua và người bán có thỏa thuận hoặc loại hóa đơn đặc thù có quy định riêng.\n\nHóa đơn vẫn phải có đầy đủ các nội dung bắt buộc khác và chữ ký của người bán theo trường hợp áp dụng.",
      [invoiceDecreeCandidate()],
    );
  }

  if (/\bda dang ky\b/.test(normalized) && /\bhoa don dien tu\b/.test(normalized) && /\bmay tinh tien\b/.test(normalized)) {
    return response(
      query,
      "Không. Tổ chức kinh tế, hộ kinh doanh hoặc cá nhân kinh doanh đã đăng ký sử dụng hóa đơn điện tử có mã hoặc không có mã thì không bắt buộc phải đăng ký thêm hóa đơn điện tử khởi tạo từ máy tính tiền theo Nghị định số 254/2026/NĐ-CP.\n\nDoanh nghiệp vẫn phải bảo đảm loại hóa đơn đang sử dụng phù hợp với hoạt động và đáp ứng định dạng, nội dung, thời điểm lập và truyền dữ liệu theo quy định.",
      [invoiceDecreeCandidate(), invoiceCircularCandidate()],
    );
  }

  if (/\bca dem\b/.test(normalized) && /\bngay lam viec tiep theo\b/.test(normalized) && /\bhoa don\b/.test(normalized)) {
    return response(
      query,
      "Có. Trường hợp người bán không có phần mềm lập hóa đơn tự động khi bán hàng trong ca đêm thì được lập hóa đơn chậm nhất vào ngày làm việc tiếp theo theo Nghị định số 254/2026/NĐ-CP.\n\nNgoại lệ này áp dụng cho tình huống được văn bản quy định; không phải lý do chung để mọi giao dịch được tùy ý lùi thời điểm lập hóa đơn.",
      [invoiceDecreeCandidate(), invoiceCircularCandidate()],
    );
  }

  if (/\b(?:to giac|phan anh|bao tin)\b/.test(normalized) && /\bkhong (?:lap|giao) hoa don\b/.test(normalized)) {
    return response(
      query,
      "Có thể được xem xét khen thưởng. Theo Nghị định số 254/2026/NĐ-CP và Thông tư số 91/2026/TT-BTC, người tiêu dùng phải cung cấp thông tin trung thực, chính xác, kịp thời; nội dung phải đủ căn cứ để cơ quan thuế kiểm tra, xác minh và dẫn đến quyết định xử phạt vi phạm hành chính về thuế, hóa đơn.\n\nViệc gửi phản ánh không tự động làm phát sinh thưởng; phải đáp ứng các điều kiện và trình tự khen thưởng theo quy định.",
      [invoiceDecreeCandidate(), invoiceCircularCandidate()],
    );
  }

  if (/\b(?:no thue|chua hoan thanh nghia vu thue)\b/.test(normalized) && /\b(?:xuat canh|tam hoan xuat canh)\b/.test(normalized)) {
    return response(
      query,
      "Có thể bị tạm hoãn xuất cảnh, nhưng không phải mọi cá nhân chỉ cần có nợ thuế đều tự động bị áp dụng. Luật Quản lý thuế số 108/2025/QH15 quy định đối với các nhóm như cá nhân kinh doanh, chủ hộ kinh doanh, chủ sở hữu hưởng lợi hoặc người đại diện theo pháp luật thuộc trường hợp bị cưỡng chế mà chưa hoàn thành nghĩa vụ; hoặc không còn hoạt động tại địa chỉ đăng ký và chưa hoàn thành nghĩa vụ thuế.\n\nCần kiểm tra đúng tư cách của cá nhân, tình trạng cưỡng chế hoặc tình trạng hoạt động tại địa chỉ đăng ký và quyết định/thông báo của cơ quan có thẩm quyền.",
      [taxAdministrationLawCandidate(), taxAdministrationDecreeCandidate()],
      ["Kết luận cụ thể cần đối chiếu tình trạng nợ, quyết định cưỡng chế và thông báo tạm hoãn xuất cảnh của từng hồ sơ."],
      0.95,
    );
  }

  if (/\bdoanh nghiep moi thanh lap\b/.test(normalized) && /\b(?:tam nop|thue thu nhap doanh nghiep|tndn)\b/.test(normalized) && /\b1 ty\b/.test(normalized)) {
    return response(
      query,
      "Không. Doanh nghiệp mới thành lập trong kỳ tính thuế và dự kiến tổng doanh thu trong kỳ không quá 01 tỷ đồng thì không phải tạm nộp thuế thu nhập doanh nghiệp theo Nghị định số 141/2026/NĐ-CP.\n\nKết thúc kỳ tính thuế, nếu tổng doanh thu thực tế vượt 01 tỷ đồng thì doanh nghiệp phải kê khai, quyết toán thuế TNDN theo quy định; đối với phần phát sinh do vượt ngưỡng này, Nghị định quy định không phải tính tiền chậm nộp theo cơ chế chuyển tiếp tương ứng. Điều kiện miễn không áp dụng máy móc cho công ty con hoặc doanh nghiệp có quan hệ liên kết không đáp ứng điều kiện của văn bản.",
      [householdThresholdCandidate(), corporateTaxCandidate()],
    );
  }

  if (/\bluat quan ly thue\b/.test(normalized) && /\b(?:hieu luc|ap dung som|ho kinh doanh)\b/.test(normalized)) {
    return response(
      query,
      "Luật Quản lý thuế số 108/2025/QH15 có hiệu lực chung từ ngày 01/07/2026. Riêng các quy định về kê khai, tính thuế đối với hộ kinh doanh, cá nhân kinh doanh và việc sử dụng hóa đơn điện tử của nhóm này có hiệu lực sớm từ ngày 01/01/2026.\n\nKhi xử lý hồ sơ sau ngày 01/07/2026, cần đồng thời đối chiếu các nghị định và thông tư hướng dẫn mới như Nghị định số 252/2026/NĐ-CP, Nghị định số 254/2026/NĐ-CP, Thông tư số 90/2026/TT-BTC và Thông tư số 91/2026/TT-BTC theo đúng nghiệp vụ.",
      [taxAdministrationLawCandidate(), taxAdministrationDecreeCandidate(), invoiceDecreeCandidate(), registrationCandidate()],
    );
  }

  const isHousehold = /\b(?:ho kinh doanh|ca nhan kinh doanh)\b/.test(normalized);
  const amount = parseMoney(query);
  if (isHousehold && amount !== null && /\b(?:gtgt|tncn|nop thue|thue gia tri gia tang|thue thu nhap ca nhan)\b/.test(normalized)) {
    const below = amount <= 1_000_000_000;
    return response(
      query,
      below
        ? "Không. Nếu số tiền nêu trong câu hỏi là tổng doanh thu của cả năm và không vượt 01 tỷ đồng, hộ kinh doanh/cá nhân kinh doanh không chịu thuế GTGT và không phải nộp thuế TNCN theo Nghị định số 141/2026/NĐ-CP, áp dụng từ ngày 01/01/2026.\n\nKết luận này không đồng nghĩa được miễn đăng ký thuế, thông báo/kê khai doanh thu, hóa đơn hoặc các loại thuế khác nếu có."
        : "Có phát sinh nghĩa vụ xác định thuế. Khi tổng doanh thu năm vượt 01 tỷ đồng, hộ kinh doanh/cá nhân kinh doanh phải xác định thuế GTGT và TNCN theo phương pháp, ngành nghề và doanh thu tính thuế áp dụng cho mình; mức cụ thể không thể xác định chỉ từ tổng doanh thu.",
      [householdThresholdCandidate(), householdProcedureCandidate()],
      ["Phải cộng tổng doanh thu của tất cả hoạt động và địa điểm kinh doanh trong năm theo phạm vi pháp luật quy định."],
    );
  }

  if (isHousehold && /\b(?:tren|hon|1[.,]?2)\s*ty\b/.test(normalized) && /\bmay tinh tien\b/.test(normalized)) {
    return response(
      query,
      "Không nhất thiết phải dùng riêng hóa đơn điện tử khởi tạo từ máy tính tiền. Hộ kinh doanh/cá nhân kinh doanh có doanh thu năm trên 01 tỷ đồng phải áp dụng hóa đơn điện tử có mã của cơ quan thuế hoặc hóa đơn điện tử khởi tạo từ máy tính tiền có kết nối dữ liệu với cơ quan thuế theo Nghị định số 141/2026/NĐ-CP.\n\nNếu đã đăng ký sử dụng hóa đơn điện tử có mã hoặc không có mã phù hợp thì Nghị định số 254/2026/NĐ-CP không bắt buộc đăng ký thêm hóa đơn khởi tạo từ máy tính tiền.",
      [householdThresholdCandidate(), invoiceDecreeCandidate(), invoiceCircularCandidate()],
    );
  }

  if (isHousehold && /\b(?:duoi|khong qua|tu 1 ty tro xuong)\b/.test(normalized) && /\b(?:ke khai|thong bao) doanh thu\b/.test(normalized)) {
    return response(
      query,
      "Có. Hộ kinh doanh/cá nhân kinh doanh có doanh thu năm từ 01 tỷ đồng trở xuống vẫn thực hiện thông báo doanh thu hoặc tờ khai năm theo Mẫu số 01/TKN-CNKD tại Thông tư số 50/2026/TT-BTC.\n\nViệc không phải nộp thuế GTGT và TNCN do doanh thu không vượt ngưỡng không đồng nghĩa được miễn nghĩa vụ thông báo/kê khai doanh thu với cơ quan thuế.",
      [householdProcedureCandidate(), householdThresholdCandidate()],
    );
  }

  return null;
}

function isBinaryQuestion(query: string) {
  const normalized = normalize(query);
  return /\b(?:co can|co phai|co duoc|co .* khong|phai khong|duoc khong)\b/.test(normalized);
}

function hasExplicitBinaryConclusion(answer: string) {
  const head = normalize(answer.slice(0, 320));
  return (
    /^(?:co|khong|co the|khong nhat thiet|chua the ket luan|chua du can cu)\b/.test(head) ||
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
