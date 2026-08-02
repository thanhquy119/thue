import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTaxQuestion } from "../lib/legal/question-intelligence.ts";
import { verifiedExtraQuestionResponse } from "../lib/legal/verified-question-rules-extra.ts";

type AdvancedQuestionCase = {
  id: string;
  category: string;
  query: string;
  variants: string[];
  expectedConclusion: string;
  anchors: string[];
  mustNotInfer: string;
  safeRefusalWhen: string;
};

function typoVariant(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/ma so thue/g, "max so thue")
    .replace(/trang thai/g, "trang tai")
    .replace(/[^a-z0-9%/_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function advanced(
  id: string,
  category: string,
  query: string,
  expectedConclusion: string,
  anchors: string[],
  mustNotInfer: string,
  safeRefusalWhen: string,
): AdvancedQuestionCase {
  return {
    id,
    category,
    query,
    variants: [typoVariant(query)],
    expectedConclusion,
    anchors,
    mustNotInfer,
    safeRefusalWhen,
  };
}

const ADVANCED_QUESTION_CATALOG: AdvancedQuestionCase[] = [
  advanced("vat-import-deduction", "GTGT nhập khẩu", "Công ty mua hàng hóa nhập khẩu được khấu trừ thuế đầu vào không?", "Có điều kiện", ["48/2024/QH15", "181/2025/NĐ-CP", "144/2026/NĐ-CP"], "Không suy ra được khấu trừ chỉ từ việc đã mở tờ khai hải quan.", "Thiếu phương pháp tính thuế, mục đích sử dụng hoặc chứng từ nộp thuế nhập khẩu."),
  advanced("vat-import-mixed-use", "GTGT nhập khẩu", "Hàng nhập khẩu dùng chung cho hoạt động chịu thuế và không chịu thuế thì phân bổ thuế đầu vào thế nào?", "Chỉ khấu trừ phần liên quan hoạt động chịu thuế.", ["48/2024/QH15", "181/2025/NĐ-CP"], "Không cho khấu trừ toàn bộ khi chưa xác định tỷ lệ sử dụng.", "Không có dữ liệu doanh thu hoặc tiêu thức phân bổ phù hợp."),
  advanced("vat-import-payment", "GTGT nhập khẩu", "Đã nộp thuế GTGT nhập khẩu nhưng thanh toán tiền hàng bằng tiền mặt thì có được khấu trừ không?", "Phải kiểm tra điều kiện thanh toán và ngoại lệ.", ["181/2025/NĐ-CP", "144/2026/NĐ-CP"], "Không đồng nhất chứng từ nộp thuế với chứng từ thanh toán tiền hàng.", "Chưa rõ giá trị giao dịch, phương thức thanh toán và trường hợp ngoại lệ."),
  advanced("vat-import-gift", "GTGT nhập khẩu", "Hàng nhập khẩu dùng để biếu tặng khách hàng có được khấu trừ thuế GTGT đầu vào không?", "Phụ thuộc mục đích kinh doanh và hồ sơ.", ["48/2024/QH15", "181/2025/NĐ-CP"], "Không mặc nhiên loại hoặc chấp nhận toàn bộ chỉ vì là hàng biếu tặng.", "Thiếu chính sách tặng, đối tượng nhận và cách hạch toán thuế đầu ra."),
  advanced("vat-import-late", "GTGT nhập khẩu", "Chứng từ nộp thuế GTGT nhập khẩu bị kê khai sót thì kê khai bổ sung đến thời điểm nào?", "Xác định theo quy định khai bổ sung.", ["108/2025/QH15", "252/2026/NĐ-CP"], "Không tự đặt thời hạn cố định nếu chưa đối chiếu kỳ khai và kiểm tra thuế.", "Chưa rõ kỳ kê khai và đã có quyết định kiểm tra hay chưa."),
  advanced("vat-import-trust", "GTGT nhập khẩu", "Nhập khẩu ủy thác thì bên giao hay bên nhận ủy thác được khấu trừ thuế GTGT?", "Xác định theo chủ thể, chứng từ và hợp đồng.", ["181/2025/NĐ-CP"], "Không cho cả hai bên cùng khấu trừ một khoản thuế.", "Thiếu hợp đồng ủy thác, tờ khai và chứng từ nộp thuế."),

  advanced("vat-refund-investment", "Hoàn thuế GTGT", "Dự án đầu tư đang xây dựng có số thuế đầu vào chưa khấu trừ hết thì điều kiện hoàn thuế là gì?", "Kiểm tra dự án, giai đoạn đầu tư và điều kiện hồ sơ.", ["48/2024/QH15", "181/2025/NĐ-CP", "144/2026/NĐ-CP"], "Không suy ra được hoàn chỉ vì số thuế đầu vào lớn.", "Thiếu giấy phép đầu tư, kỳ hoàn và tình trạng dự án."),
  advanced("vat-refund-export", "Hoàn thuế GTGT", "Doanh nghiệp xuất khẩu có thuế đầu vào chưa khấu trừ hết thì được hoàn trong trường hợp nào?", "Phải đáp ứng điều kiện xuất khẩu và thanh toán.", ["48/2024/QH15", "181/2025/NĐ-CP"], "Không coi mọi doanh thu xuất khẩu là đủ điều kiện hoàn.", "Thiếu hợp đồng, tờ khai hải quan và chứng từ thanh toán."),
  advanced("vat-refund-offset", "Hoàn thuế GTGT", "Khoản thuế GTGT được hoàn có phải bù trừ với nghĩa vụ thuế đang nợ trước khi chi hoàn không?", "Đối chiếu quy định bù trừ và tình trạng khoản nợ.", ["108/2025/QH15", "252/2026/NĐ-CP"], "Không tự động coi mọi khoản đang hiển thị là nợ được bù trừ.", "Chưa xác định khoản nợ, khoản nộp thừa và quyết định hoàn."),
  advanced("vat-refund-risk-invoice", "Hoàn thuế GTGT", "Hồ sơ hoàn thuế có hóa đơn của doanh nghiệp bỏ địa chỉ kinh doanh thì xử lý thế nào?", "Xác minh giao dịch và hóa đơn.", ["108/2025/QH15", "252/2026/NĐ-CP"], "Không suy ra hóa đơn giả chỉ từ trạng thái địa chỉ.", "Không có hồ sơ giao nhận, thanh toán và kết quả xác minh."),

  advanced("cit-accrual", "Thuế TNDN", "Chi phí trích trước chưa có hóa đơn đến cuối năm có được tính vào chi phí được trừ không?", "Phụ thuộc căn cứ trích trước và điều chỉnh thực tế.", ["Luật Thuế TNDN hiện hành"], "Không chấp nhận chỉ vì đã hạch toán kế toán.", "Thiếu hợp đồng, dự toán và thời điểm hoàn thành."),
  advanced("cit-related-interest", "Thuế TNDN", "Doanh nghiệp có giao dịch liên kết thì giới hạn chi phí lãi vay được trừ xác định thế nào?", "Phải xác định lãi vay ròng và EBITDA thuế.", ["Quy định giao dịch liên kết hiện hành"], "Không áp giới hạn khi chưa xác định có giao dịch liên kết.", "Thiếu quan hệ liên kết và số liệu lãi vay, lãi tiền gửi, EBITDA."),
  advanced("cit-provision", "Thuế TNDN", "Dự phòng nợ phải thu khó đòi cần điều kiện gì để được tính vào chi phí được trừ?", "Phải đúng đối tượng, hồ sơ, mức trích và thời điểm.", ["Luật Thuế TNDN hiện hành"], "Không coi mọi khoản quá hạn là nợ khó đòi đủ điều kiện.", "Thiếu hợp đồng, đối chiếu công nợ và biện pháp thu hồi."),
  advanced("cit-fx", "Thuế TNDN", "Lỗ chênh lệch tỷ giá cuối năm của khoản phải thu có được tính vào chi phí được trừ không?", "Phân biệt đánh giá lại và chênh lệch đã thực hiện.", ["Luật Thuế TNDN hiện hành"], "Không gộp mọi chênh lệch tỷ giá vào một cách xử lý.", "Chưa rõ loại khoản mục, đồng tiền và thời điểm ghi nhận."),
  advanced("cit-loss", "Thuế TNDN", "Hoạt động ưu đãi và không ưu đãi được chuyển lỗ giữa các hoạt động thế nào?", "Hạch toán riêng và chuyển lỗ đúng nguồn.", ["Luật Thuế TNDN hiện hành"], "Không tự bù trừ toàn bộ giữa các mức ưu đãi khác nhau.", "Không có số liệu hạch toán riêng theo từng hoạt động."),

  advanced("pit-residency", "Thuế TNCN", "Người nước ngoài ở Việt Nam dưới 183 ngày nhưng có nơi ở thường xuyên thì có là cá nhân cư trú không?", "Xét số ngày, nơi ở và chứng minh cư trú nước ngoài.", ["Luật Thuế TNCN hiện hành"], "Không chỉ dựa duy nhất số ngày hiện diện.", "Thiếu lịch xuất nhập cảnh, hợp đồng thuê và giấy cư trú."),
  advanced("pit-authorization", "Thuế TNCN", "Cá nhân có thu nhập hai nơi, nơi thứ hai khấu trừ 10% thì có được ủy quyền quyết toán không?", "Phụ thuộc tính chất thu nhập vãng lai và điều kiện ủy quyền.", ["Luật Thuế TNCN hiện hành"], "Không mặc nhiên cho ủy quyền chỉ vì đã khấu trừ 10%.", "Thiếu loại hợp đồng và tổng thu nhập nơi thứ hai."),
  advanced("pit-dependent", "Thuế TNCN", "Người phụ thuộc đăng ký muộn thì được giảm trừ từ tháng nuôi dưỡng hay tháng đăng ký?", "Phân biệt khai tạm tính và quyết toán.", ["Luật Thuế TNCN hiện hành"], "Không cho giảm trừ khi trùng đăng ký hoặc thiếu điều kiện.", "Thiếu quan hệ, thu nhập và thời điểm phát sinh nuôi dưỡng."),
  advanced("pit-housing", "Thuế TNCN", "Công ty trả tiền thuê nhà cho người lao động thì phần nào tính vào thu nhập chịu thuế?", "Áp điều kiện và giới hạn khoản lợi ích nhà ở.", ["Luật Thuế TNCN hiện hành"], "Không mặc nhiên tính toàn bộ hoặc miễn toàn bộ.", "Thiếu tiền lương chịu thuế và số tiền nhà thực trả."),

  advanced("invoice-return", "Hóa đơn điện tử", "Khách hàng trả lại một phần hàng thì người bán lập hóa đơn điều chỉnh hay người mua lập hóa đơn trả lại?", "Xác định theo vai trò và quy định hiện hành.", ["254/2026/NĐ-CP", "91/2026/TT-BTC"], "Không áp một cách xử lý cho mọi loại người mua.", "Thiếu loại người mua và tình trạng giao nhận, thanh toán."),
  advanced("invoice-discount", "Hóa đơn điện tử", "Chiết khấu thương mại theo doanh số cuối kỳ thì lập hóa đơn điều chỉnh thế nào?", "Đối chiếu hợp đồng và kỳ chiết khấu.", ["254/2026/NĐ-CP", "91/2026/TT-BTC"], "Không chọn hóa đơn tổng khi dữ liệu không hỗ trợ.", "Thiếu kỳ chiết khấu, danh sách hóa đơn và thỏa thuận."),
  advanced("invoice-rate", "Hóa đơn điện tử", "Hóa đơn điện tử ghi sai thuế suất làm tăng tiền thuế thì điều chỉnh hay thay thế?", "Chọn một phương thức xử lý đúng quy định.", ["254/2026/NĐ-CP", "91/2026/TT-BTC"], "Không vừa điều chỉnh vừa thay thế cùng một sai sót.", "Chưa rõ hóa đơn đã gửi và đã kê khai hay chưa."),
  advanced("invoice-timing", "Hóa đơn điện tử", "Dịch vụ thu tiền trước nhưng hoàn thành sau thì thời điểm lập hóa đơn thế nào?", "Phân biệt tiền trước, đặt cọc và thời điểm cung cấp.", ["254/2026/NĐ-CP"], "Không coi mọi khoản nhận trước là doanh thu lập hóa đơn ngay.", "Thiếu loại dịch vụ và bản chất khoản tiền nhận."),
  advanced("invoice-delegation", "Hóa đơn điện tử", "Doanh nghiệp ủy nhiệm cho sàn thương mại điện tử lập hóa đơn thì bên nào chịu trách nhiệm dữ liệu?", "Phân định trách nhiệm người bán và bên nhận ủy nhiệm.", ["254/2026/NĐ-CP", "91/2026/TT-BTC"], "Không chuyển toàn bộ trách nhiệm thuế cho bên nhận ủy nhiệm.", "Thiếu hợp đồng ủy nhiệm và mô hình phát hành."),

  advanced("admin-zero-debt", "Quản lý thuế và mã số thuế", "Người nộp thuế không còn nợ nhưng chưa hoàn thành chấm dứt hiệu lực mã số thuế thì có xác nhận hoàn thành nghĩa vụ không?", "Số dư nợ bằng 0 không đồng nghĩa hoàn thành toàn bộ nghĩa vụ.", ["108/2025/QH15", "252/2026/NĐ-CP", "90/2026/TT-BTC"], "Không ghi còn nợ khi số liệu nợ bằng 0; phải nêu thủ tục còn thiếu.", "Chưa biết loại giấy xác nhận và nghĩa vụ chưa hoàn tất."),
  advanced("admin-inactive", "Quản lý thuế và mã số thuế", "Người nộp thuế trạng thái không hoạt động tại địa chỉ đăng ký nhưng không nợ thuế thì có được xác nhận không nợ không?", "Trạng thái địa chỉ không tự chứng minh có nợ.", ["108/2025/QH15", "252/2026/NĐ-CP", "90/2026/TT-BTC"], "Không từ chối chỉ bằng tên trạng thái mà không nêu nghĩa vụ còn thiếu.", "Chưa rõ mục đích xác nhận và hồ sơ còn tồn tại."),
  advanced("admin-overpayment", "Quản lý thuế và mã số thuế", "Người nộp thuế vừa nộp thừa vừa có khoản nợ ở địa bàn khác thì bù trừ thế nào?", "Xác định chủ thể, loại nghĩa vụ và thứ tự bù trừ.", ["108/2025/QH15", "252/2026/NĐ-CP"], "Không bù trừ giữa các chủ thể hoặc khoản không đủ điều kiện.", "Thiếu mã nghĩa vụ, cơ quan quản lý và trạng thái khoản tiền."),
  advanced("admin-appeal", "Quản lý thuế và mã số thuế", "Doanh nghiệp khiếu nại quyết định ấn định thuế thì có bị cưỡng chế khoản tiền đó không?", "Đối chiếu hiệu lực, hạn nộp và tạm đình chỉ nếu có.", ["108/2025/QH15", "252/2026/NĐ-CP"], "Không coi khiếu nại tự động dừng mọi biện pháp cưỡng chế.", "Thiếu quyết định, thời hạn nộp và văn bản tạm đình chỉ."),
  advanced("admin-dependent", "Quản lý thuế và mã số thuế", "Công ty mẹ chấm dứt mã số thuế khi chi nhánh còn nghĩa vụ khai thuế thì xử lý thế nào?", "Hoàn tất hoặc chuyển giao nghĩa vụ đơn vị phụ thuộc.", ["90/2026/TT-BTC", "252/2026/NĐ-CP"], "Không bỏ sót nghĩa vụ của đơn vị phụ thuộc.", "Chưa xác định trạng thái và nghĩa vụ từng chi nhánh."),

  advanced("fct-software", "Nhà thầu nước ngoài và thương mại điện tử", "Mua phần mềm kèm hỗ trợ của nhà cung cấp nước ngoài thì thuế nhà thầu tính thế nào?", "Tách cấu phần hợp đồng và xác định phương pháp nộp.", ["Quy định thuế nhà thầu hiện hành"], "Không áp một tỷ lệ cho toàn bộ khi cấu phần tách được.", "Thiếu hợp đồng, quyền sử dụng và nơi thực hiện dịch vụ."),
  advanced("ecommerce-withholding", "Nhà thầu nước ngoài và thương mại điện tử", "Sàn thương mại điện tử nước ngoài thu tiền hộ người bán Việt Nam thì bên nào kê khai và nộp thuế?", "Xác định trách nhiệm theo mô hình thanh toán.", ["108/2025/QH15", "252/2026/NĐ-CP"], "Không mặc nhiên miễn nghĩa vụ người bán khi sàn không khấu trừ.", "Thiếu luồng thanh toán và tư cách pháp lý nền tảng."),
  advanced("cross-border-ads", "Nhà thầu nước ngoài và thương mại điện tử", "Mua quảng cáo của nền tảng nước ngoài đã đăng ký thuế tại Việt Nam thì có khấu trừ thuế nhà thầu không?", "Kiểm tra cơ chế tự khai, chứng từ và trách nhiệm bên mua.", ["108/2025/QH15", "252/2026/NĐ-CP"], "Không suy ra đã đăng ký là đã nộp đủ cho mọi giao dịch.", "Thiếu mã số thuế, chứng từ và kỳ giao dịch."),

  advanced("excise-combo", "Thuế khác", "Combo có một hàng hóa chịu thuế tiêu thụ đặc biệt thì giá tính thuế xác định thế nào?", "Phân bổ giá và xác định đúng hàng chịu thuế.", ["Luật Thuế tiêu thụ đặc biệt hiện hành"], "Không áp thuế toàn bộ combo nếu có căn cứ tách riêng.", "Thiếu bảng giá, hợp đồng và cách ghi hóa đơn."),
  advanced("resource-loss", "Thuế khác", "Tài nguyên khai thác bị hao hụt trong định mức thì sản lượng tính thuế xác định thế nào?", "Đối chiếu sản lượng, định mức và đo đếm.", ["Luật Thuế tài nguyên hiện hành"], "Không tự trừ mọi hao hụt do doanh nghiệp khai báo.", "Thiếu định mức, hồ sơ đo đếm và loại tài nguyên."),
  advanced("land-rent-transfer", "Thuế khác", "Chuyển nhượng dự án đang được miễn tiền thuê đất thì bên nhận có tiếp tục được miễn không?", "Phụ thuộc điều kiện ưu đãi và kế thừa dự án.", ["Pháp luật đất đai và tiền thuê đất hiện hành"], "Không coi ưu đãi tự động chuyển theo tài sản.", "Thiếu quyết định đầu tư, thuê đất và nội dung chuyển nhượng."),
];

function verified(query: string) {
  const result = verifiedExtraQuestionResponse(query);
  assert.ok(result, `Expected a verified answer for: ${query}`);
  return result;
}

test("imported goods input VAT receives a conditional answer with current legal anchors", () => {
  for (const query of [
    "Công ty mua Hàng hóa nhập khẩu được khấu trừ thuế đầu vào không",
    "cong ty mua hang hoa nhap khau co duoc khau tru thue dau vao khong",
  ]) {
    const result = verified(query);
    assert.match(result.direct_answer, /^Có, nếu đáp ứng đủ điều kiện khấu trừ\./u);
    assert.match(result.direct_answer, /Điều 23/u);
    for (const number of ["48/2024/QH15", "181/2025/NĐ-CP", "144/2026/NĐ-CP"]) {
      assert.ok(result.candidates.some((item) => item.number === number));
    }
  }
});

test("unfinished tax-id cessation distinguishes zero debt from completed obligations and repairs max typo", () => {
  for (const query of [
    "Trường hợp người nộp thuế không còn nợ thuế nhưng chưa hoàn thành thủ tục chấm dứt hiệu lực mã số thuế thì từ chối xác nhận không nợ theo quy định nào?",
    "nguoi nop thue khong con no thue nhung chua hoan thanh cham dut hieu luc max so thue thi tu choi xac nhan khong no theo quy dinh nao",
  ]) {
    const result = verified(query);
    assert.match(result.direct_answer, /số dư nợ bằng 0 cũng chưa đủ/u);
    assert.match(result.direct_answer, /không nên dùng lý do chung chung “còn nợ”/u);
    assert.ok(result.candidates.some((item) => item.number === "90/2026/TT-BTC"));
    assert.ok(result.warnings.some((warning) => warning.includes("tên thủ tục")));
  }
});

test("inactive registered-address status does not automatically prove tax debt and repairs trang tai typo", () => {
  for (const query of [
    "Hướng dẫn chi tiết về việc người nộp thuế trạng thái không hoạt động tại địa chỉ đăng ký không xác nhận nợ thuế theo quy định nào",
    "nguoi nop thue trang tai khong hoat dong tai dia chi dang ky khong xac nhan no thue theo quy dinh nao",
  ]) {
    const result = verified(query);
    assert.match(result.direct_answer, /không chứng minh người nộp thuế còn số tiền thuế nợ/u);
    assert.match(result.direct_answer, /không chỉ ghi chung chung trạng thái địa chỉ/u);
    assert.ok(result.candidates.some((item) => item.number === "252/2026/NĐ-CP"));
  }
});

test("historical periods are not overwritten by current deterministic answers", () => {
  assert.equal(
    verifiedExtraQuestionResponse("Năm 2025 công ty mua hàng nhập khẩu có được khấu trừ thuế đầu vào không?"),
    null,
  );
});

test("advanced catalog covers major tax practice areas with variants, anchors and safety gates", () => {
  assert.ok(ADVANCED_QUESTION_CATALOG.length >= 30);
  const categories = new Set(ADVANCED_QUESTION_CATALOG.map((item) => item.category));
  for (const category of [
    "GTGT nhập khẩu",
    "Hoàn thuế GTGT",
    "Thuế TNDN",
    "Thuế TNCN",
    "Hóa đơn điện tử",
    "Quản lý thuế và mã số thuế",
    "Nhà thầu nước ngoài và thương mại điện tử",
    "Thuế khác",
  ]) assert.ok(categories.has(category), `Missing category: ${category}`);

  for (const item of ADVANCED_QUESTION_CATALOG) {
    assert.ok(item.query.endsWith("?"), `${item.id} must be a natural question`);
    assert.ok(item.variants.length >= 1 && !/[À-ỹ]/u.test(item.variants[0]), `${item.id} needs a no-accent variant`);
    assert.ok(item.anchors.length >= 1, `${item.id} needs a legal anchor`);
    assert.ok(item.expectedConclusion.length >= 12, `${item.id} needs an expected conclusion`);
    assert.ok(item.mustNotInfer.length >= 20, `${item.id} needs an anti-inference rule`);
    assert.ok(item.safeRefusalWhen.length >= 20, `${item.id} needs a safe-refusal condition`);
  }
});

test("question intelligence recognizes representative advanced questions", () => {
  const imported = analyzeTaxQuestion(ADVANCED_QUESTION_CATALOG[0].query);
  assert.equal(imported.isQuestion, true);
  assert.ok(imported.taxAreas.includes("thuế xuất nhập khẩu"));
  assert.ok(imported.intents.includes("khấu trừ thuế, chi phí được trừ"));
});
