import type { SearchCandidate, TaxSearchResponse } from "./types";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9%/_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bmax so thue\b/g, "ma so thue")
    .replace(/\bma so thuee\b/g, "ma so thue")
    .replace(/\btrang tai\b/g, "trang thai")
    .replace(/\bkhong hoat dong tai dia chi kinh doanh\b/g, "khong hoat dong tai dia chi dang ky");
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
    source_label: sourceUrl.includes("congbao.chinhphu.vn")
      ? "Công báo điện tử Chính phủ"
      : "Cổng Thông tin điện tử Chính phủ",
  };
}

function registrationCandidate() {
  return officialCandidate(
    "verified-extra-90-2026-tt-btc",
    "90/2026/TT-BTC",
    "Quy định về đăng ký thuế, có hiệu lực từ ngày 01/07/2026",
    "Thông tư",
    "Bộ Tài chính",
    "2026-06-30",
    "https://xaydungchinhsach.chinhphu.vn/mot-so-diem-moi-cua-thong-tu-90-2026-tt-btc-ve-dang-ky-thue-11926071714240164.htm",
  );
}

function taxAdministrationLawCandidate() {
  return officialCandidate(
    "verified-extra-108-2025-qh15",
    "108/2025/QH15",
    "Luật Quản lý thuế, có hiệu lực từ ngày 01/07/2026",
    "Luật",
    "Quốc hội",
    "2025-12-10",
    "https://xaydungchinhsach.chinhphu.vn/toan-van-luat-quan-ly-thue-co-hieu-luc-tu-1-7-2026-119260626174633402.htm",
  );
}

function taxAdministrationDecreeCandidate() {
  return officialCandidate(
    "verified-extra-252-2026-nd-cp",
    "252/2026/NĐ-CP",
    "Quy định chi tiết và biện pháp tổ chức thi hành Luật Quản lý thuế",
    "Nghị định",
    "Chính phủ",
    "2026-06-30",
    "https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-dinh-252-2026-nd-cp-huong-dan-thi-hanh-luat-quan-ly-thue-119260715155021635.htm",
  );
}

function vatLawCandidate() {
  return officialCandidate(
    "verified-extra-48-2024-qh15",
    "48/2024/QH15",
    "Luật Thuế giá trị gia tăng, có hiệu lực từ ngày 01/07/2025",
    "Luật",
    "Quốc hội",
    "2024-11-26",
    "https://congbao.chinhphu.vn/van-ban/luat-so-48-2024-qh15-43576/53720.htm",
  );
}

function vatDecreeCandidate() {
  return officialCandidate(
    "verified-extra-181-2025-nd-cp",
    "181/2025/NĐ-CP",
    "Quy định chi tiết thi hành Luật Thuế giá trị gia tăng",
    "Nghị định",
    "Chính phủ",
    "2025-07-01",
    "https://xaydungchinhsach.chinhphu.vn/nghi-dinh-181-2025-nd-cp-quy-dinh-chi-tiet-thi-hanh-mot-so-dieu-cua-luat-thue-gia-tri-gia-tang-119250707172930626.htm",
  );
}

function vatAmendmentCandidate() {
  return officialCandidate(
    "verified-extra-144-2026-nd-cp",
    "144/2026/NĐ-CP",
    "Sửa đổi Nghị định 181/2025/NĐ-CP về thuế giá trị gia tăng, sau khi đã được sửa đổi bởi Nghị định 359/2025/NĐ-CP",
    "Nghị định",
    "Chính phủ",
    "2026-06-20",
    "https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-144-2026-nd-cp-469482.htm",
  );
}

function repeal97Candidate() {
  return officialCandidate(
    "verified-extra-97-2026-tt-btc",
    "97/2026/TT-BTC",
    "Bãi bỏ Thông tư số 55/2010/TT-BTC về thuế GTGT và thuế TNDN đối với các đài truyền hình, phát thanh truyền hình",
    "Thông tư",
    "Bộ Tài chính",
    "2026-07-06",
    "https://vanban.chinhphu.vn/?classid=1&docid=218797&orggroupid=4&pageid=27160",
  );
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

function answer(
  query: string,
  directAnswer: string,
  candidates: SearchCandidate[],
  confidence = 0.98,
  warnings: string[] = [],
): TaxSearchResponse {
  return {
    query_normalized: normalize(query),
    query_kind: "question",
    direct_answer: directAnswer,
    document: null,
    candidates,
    warnings,
    confidence,
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

function importedGoodsInputVatResponse(query: string) {
  return answer(
    query,
    "Có, nếu đáp ứng đủ điều kiện khấu trừ. Doanh nghiệp áp dụng phương pháp khấu trừ được khấu trừ thuế GTGT đã nộp ở khâu nhập khẩu khi hàng hóa nhập khẩu được sử dụng cho hoạt động sản xuất, kinh doanh hàng hóa hoặc dịch vụ chịu thuế GTGT.\n\n" +
      "Điều kiện cần kiểm tra gồm: có tờ khai hải quan và chứng từ nộp thuế GTGT khâu nhập khẩu hợp pháp; hạch toán, kê khai đúng kỳ; đáp ứng yêu cầu về chứng từ thanh toán không dùng tiền mặt đối với giao dịch thuộc diện phải áp dụng; và hàng hóa không thuộc trường hợp pháp luật loại khỏi khấu trừ. Nghị định số 181/2025/NĐ-CP quy định nguyên tắc khấu trừ tại Điều 23, chứng từ nộp thuế tại Điều 25, thanh toán không dùng tiền mặt tại Điều 26 và các trường hợp đặc thù tại Điều 28; khi áp dụng phải đọc cùng các nội dung đã được sửa đổi bởi Nghị định số 359/2025/NĐ-CP và Nghị định số 144/2026/NĐ-CP.\n\n" +
      "Nếu hàng nhập khẩu dùng đồng thời cho hoạt động chịu thuế và không chịu thuế thì chỉ phần thuế đầu vào gắn với hoạt động chịu thuế được khấu trừ; phần không tách riêng được phải phân bổ theo quy định. Nếu hàng dùng cho hoạt động không chịu thuế, cho mục đích cá nhân hoặc hồ sơ thanh toán/chứng từ nộp thuế không hợp lệ thì không được khấu trừ tương ứng.\n\n" +
      "Hồ sơ nên đối chiếu tối thiểu: hợp đồng và chứng từ thanh toán, tờ khai hải quan, giấy nộp tiền hoặc chứng từ điện tử xác nhận đã nộp thuế GTGT khâu nhập khẩu, chứng từ nhập kho và tài liệu chứng minh mục đích sử dụng hàng hóa.",
    [vatLawCandidate(), vatDecreeCandidate(), vatAmendmentCandidate()],
    0.98,
    [
      "Kết luận cụ thể còn phụ thuộc phương pháp tính thuế của doanh nghiệp, mục đích sử dụng hàng nhập khẩu và tính hợp lệ của bộ chứng từ.",
    ],
  );
}

function unfinishedTaxIdCessationResponse(query: string) {
  return answer(
    query,
    "Không nên từ chối với lý do “còn nợ thuế” nếu dữ liệu xác định người nộp thuế thực tế không còn số tiền thuế nợ. Tuy nhiên, số dư nợ bằng 0 cũng chưa đủ để xác nhận người nộp thuế đã hoàn thành toàn bộ nghĩa vụ thuế hoặc đã hoàn tất thủ tục chấm dứt hiệu lực mã số thuế.\n\n" +
      "Theo cơ chế đăng ký thuế hiện hành từ ngày 01/07/2026, trước khi mã số thuế được chấm dứt hiệu lực, người nộp thuế còn phải hoàn thành các việc liên quan như hồ sơ khai thuế, hóa đơn, tiền thuế và tiền chậm nộp nếu có, xử lý khoản nộp thừa hoặc số thuế GTGT đầu vào chưa khấu trừ hết, đồng thời hoàn tất nghĩa vụ của đơn vị phụ thuộc theo từng trường hợp. Căn cứ cần đối chiếu là Luật Quản lý thuế số 108/2025/QH15, Nghị định số 252/2026/NĐ-CP và các điều về chấm dứt hiệu lực mã số thuế tại Thông tư số 90/2026/TT-BTC.\n\n" +
      "Vì vậy, nếu cơ quan thuế chưa xác nhận thì văn bản trả lời phải chỉ rõ thủ tục hoặc nghĩa vụ nào còn thiếu, chẳng hạn chưa nộp đủ hồ sơ khai thuế, chưa xử lý hóa đơn, chưa hoàn tất nghĩa vụ của đơn vị phụ thuộc hoặc chưa nộp hồ sơ chấm dứt hợp lệ; không nên dùng lý do chung chung “còn nợ” khi số tiền nợ đã bằng 0.\n\n" +
      "Cần phân biệt hai loại đề nghị: xác nhận riêng số tiền thuế nợ tại một thời điểm và xác nhận đã hoàn thành toàn bộ nghĩa vụ để chấm dứt hiệu lực mã số thuế. Hai kết quả này không đồng nhất.",
    [registrationCandidate(), taxAdministrationDecreeCandidate(), taxAdministrationLawCandidate()],
    0.97,
    [
      "Muốn xác định chính xác căn cứ từ chối cần biết tên thủ tục hoặc mẫu xác nhận mà người nộp thuế đã đề nghị.",
    ],
  );
}

function inactiveRegisteredAddressDebtConfirmationResponse(query: string) {
  return answer(
    query,
    "Không thể mặc nhiên kết luận có nợ hoặc từ chối xác nhận chỉ vì người nộp thuế đang ở trạng thái “không hoạt động tại địa chỉ đã đăng ký”. Đây là trạng thái quản lý thuế và dấu hiệu cần xác minh, nhưng bản thân trạng thái này không chứng minh người nộp thuế còn số tiền thuế nợ.\n\n" +
      "Cơ quan thuế cần kiểm tra tách biệt: số tiền thuế, tiền chậm nộp và tiền phạt còn phải nộp; hồ sơ khai thuế còn thiếu; tình trạng sử dụng hóa đơn; quyết định xử phạt hoặc cưỡng chế; và thủ tục khôi phục trạng thái hoạt động hoặc chấm dứt hiệu lực mã số thuế. Thông tư số 90/2026/TT-BTC là căn cứ đăng ký thuế hiện hành từ ngày 01/07/2026; việc quản lý nghĩa vụ và trạng thái phải đọc cùng Luật Quản lý thuế số 108/2025/QH15 và Nghị định số 252/2026/NĐ-CP.\n\n" +
      "Nếu người nộp thuế chỉ yêu cầu xác nhận số dư nợ, kết quả nên phản ánh đúng số liệu nợ và ghi chú trạng thái địa chỉ. Nếu yêu cầu xác nhận đã hoàn thành toàn bộ nghĩa vụ hoặc phục vụ chấm dứt hiệu lực mã số thuế thì chưa nên xác nhận hoàn tất cho đến khi các hồ sơ, hóa đơn, vi phạm và thủ tục trạng thái còn tồn tại đã được xử lý. Quyết định hoặc thông báo từ chối phải nêu đúng nghĩa vụ chưa hoàn thành, không chỉ ghi chung chung trạng thái địa chỉ.",
    [registrationCandidate(), taxAdministrationDecreeCandidate(), taxAdministrationLawCandidate()],
    0.96,
    [
      "Cần xác định rõ người nộp thuế đang xin xác nhận số dư nợ, xác nhận hoàn thành nghĩa vụ hay xác nhận để làm thủ tục chấm dứt mã số thuế.",
    ],
  );
}

export function verifiedExtraQuestionResponse(query: string): TaxSearchResponse | null {
  const normalized = normalize(query);
  const years = normalized.match(/\b20\d{2}\b/g) ?? [];
  if (years.some((year) => Number(year) <= 2025)) return null;

  const asksImportedInputVatDeduction =
    /\b(?:hang hoa )?nhap khau\b/.test(normalized) &&
    /\b(?:khau tru|thue dau vao|gtgt dau vao|gia tri gia tang dau vao|thue gtgt)\b/.test(normalized);
  if (asksImportedInputVatDeduction) return importedGoodsInputVatResponse(query);

  const asksUnfinishedTaxIdCessationConfirmation =
    /\b(?:khong con no thue|khong no thue|so du no bang 0|het no thue)\b/.test(normalized) &&
    /\b(?:cham dut hieu luc ma so thue|chua hoan thanh thu tuc cham dut|thu tuc cham dut ma so thue)\b/.test(normalized) &&
    /\b(?:xac nhan|tu choi|khong xac nhan|hoan thanh nghia vu)\b/.test(normalized);
  if (asksUnfinishedTaxIdCessationConfirmation) return unfinishedTaxIdCessationResponse(query);

  const asksInactiveAddressDebtConfirmation =
    /\b(?:khong hoat dong tai dia chi dang ky|khong hoat dong tai dia chi da dang ky|bo dia chi kinh doanh)\b/.test(normalized) &&
    /\b(?:no thue|xac nhan|khong xac nhan|hoan thanh nghia vu|tu choi)\b/.test(normalized);
  if (asksInactiveAddressDebtConfirmation) return inactiveRegisteredAddressDebtConfirmationResponse(query);

  const asksCircular97Repeal =
    /\b97\s*\/\s*2026\s*\/\s*tt-btc\b/.test(normalized) &&
    /\b(?:bai bo|van ban nao|thong tu nao|het hieu luc)\b/.test(normalized);
  if (asksCircular97Repeal) {
    return answer(
      query,
      "Thông tư số 97/2026/TT-BTC bãi bỏ toàn bộ Thông tư số 55/2010/TT-BTC ngày 16/04/2010 của Bộ trưởng Bộ Tài chính. Thông tư 55/2010/TT-BTC trước đây hướng dẫn thuế giá trị gia tăng và thuế thu nhập doanh nghiệp đối với Đài Truyền hình Việt Nam và các đài truyền hình, đài phát thanh - truyền hình tỉnh, thành phố.\n\nThông tư 97/2026/TT-BTC được ban hành và có hiệu lực từ ngày 06/07/2026.",
      [repeal97Candidate()],
      0.99,
    );
  }

  const asksNewTaxNumberAfterMove =
    /\b(?:doanh nghiep|cong ty|to chuc)\b/.test(normalized) &&
    /\b(?:chuyen tru so|chuyen dia chi|thay doi dia chi)\b/.test(normalized) &&
    /\b(?:doi ma so thue|ma so thue moi|dang ky lai ma so thue|cap lai ma so thue)\b/.test(normalized);
  if (asksNewTaxNumberAfterMove) {
    return answer(
      query,
      "Không. Doanh nghiệp chuyển trụ sở sang tỉnh khác vẫn sử dụng mã số thuế đã được cấp; việc chuyển địa chỉ không làm phát sinh một mã số thuế mới. Doanh nghiệp phải thực hiện thủ tục thay đổi thông tin đăng ký thuế và chuyển cơ quan thuế quản lý trực tiếp theo Thông tư số 90/2026/TT-BTC.\n\nCần phân biệt việc giữ nguyên mã số thuế với nghĩa vụ cập nhật địa chỉ, hồ sơ đăng ký doanh nghiệp và các thủ tục chuyển cơ quan thuế quản lý. Trường hợp thuộc diện kiểm tra tại trụ sở khi chuyển địa điểm, cơ quan thuế sẽ thông báo riêng.",
      [registrationCandidate()],
    );
  }

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

  const asksExclusiveCashRegisterInvoice =
    /\bmay tinh tien\b/.test(normalized) &&
    /\b(?:bat buoc|co phai|phai dung|chi duoc dung|chi dung)\b/.test(normalized) &&
    /\b(?:ban hang truc tiep|ban le|nguoi tieu dung|cung cap dich vu truc tiep)\b/.test(normalized);
  if (asksExclusiveCashRegisterInvoice) {
    return answer(
      query,
      "Không thể kết luận rằng cứ bán hàng trực tiếp cho người tiêu dùng thì bắt buộc chỉ được dùng hóa đơn điện tử khởi tạo từ máy tính tiền. Pháp luật về hóa đơn điện tử còn phân biệt loại người bán, ngưỡng doanh thu, ngành nghề và hình thức hóa đơn đã đăng ký.\n\nĐối với hộ kinh doanh/cá nhân kinh doanh thuộc ngưỡng phải áp dụng hóa đơn điện tử, có thể sử dụng hóa đơn điện tử có mã của cơ quan thuế hoặc hóa đơn điện tử khởi tạo từ máy tính tiền có kết nối dữ liệu theo điều kiện tương ứng; không có quy tắc chung buộc mọi người bán trực tiếp chỉ được dùng duy nhất loại hóa đơn từ máy tính tiền. Cần xác định thêm người bán là doanh nghiệp hay hộ/cá nhân kinh doanh, doanh thu năm và hình thức hóa đơn hiện đã đăng ký.",
      [invoiceDecreeCandidate(), invoiceCircularCandidate(), thresholdCandidate()],
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
