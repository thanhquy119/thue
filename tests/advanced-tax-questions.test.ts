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

const ADVANCED_QUESTION_CATALOG: AdvancedQuestionCase[] = [
  {
    id: "vat-import-deduction",
    category: "GTGT nhập khẩu",
    query: "Công ty mua hàng hóa nhập khẩu được khấu trừ thuế đầu vào không?",
    variants: ["cong ty mua hang nhap khau co duoc khau tru thue dau vao khong", "Thuế GTGT khâu nhập khẩu được khấu trừ thế nào?"],
    expectedConclusion: "Có điều kiện",
    anchors: ["48/2024/QH15", "181/2025/NĐ-CP", "144/2026/NĐ-CP"],
    mustNotInfer: "Không suy ra được khấu trừ chỉ từ việc đã mở tờ khai hải quan.",
    safeRefusalWhen: "Thiếu phương pháp tính thuế, mục đích sử dụng hoặc chứng từ nộp thuế nhập khẩu.",
  },
  {
    id: "vat-import-mixed-use",
    category: "GTGT nhập khẩu",
    query: "Hàng nhập khẩu dùng chung cho hoạt động chịu thuế và không chịu thuế thì phân bổ thuế đầu vào thế nào?",
    variants: ["hang nhap khau dung chung chiu thue va khong chiu thue khau tru sao"],
    expectedConclusion: "Chỉ khấu trừ phần liên quan hoạt động chịu thuế; phần không tách được phải phân bổ.",
    anchors: ["48/2024/QH15", "181/2025/NĐ-CP"],
    mustNotInfer: "Không cho khấu trừ toàn bộ khi chưa xác định tỷ lệ sử dụng.",
    safeRefusalWhen: "Không có dữ liệu doanh thu hoặc tiêu thức phân bổ phù hợp.",
  },
  {
    id: "vat-import-payment",
    category: "GTGT nhập khẩu",
    query: "Đã nộp thuế GTGT nhập khẩu nhưng thanh toán tiền hàng cho nhà cung cấp nước ngoài bằng tiền mặt thì có được khấu trừ không?",
    variants: ["nop vat nhap khau roi nhung tra tien mat cho nha cung cap co khau tru duoc khong"],
    expectedConclusion: "Phải kiểm tra điều kiện chứng từ thanh toán không dùng tiền mặt và ngoại lệ cụ thể.",
    anchors: ["181/2025/NĐ-CP", "144/2026/NĐ-CP"],
    mustNotInfer: "Không đồng nhất chứng từ nộp thuế nhập khẩu với chứng từ thanh toán tiền hàng.",
    safeRefusalWhen: "Chưa rõ giá trị giao dịch, phương thức thanh toán và trường hợp ngoại lệ.",
  },
  {
    id: "vat-import-gift",
    category: "GTGT nhập khẩu",
    query: "Hàng nhập khẩu dùng để biếu tặng khách hàng có được khấu trừ thuế GTGT đầu vào không?",
    variants: ["hang nhap khau bieu tang khach hang khau tru vat dau vao duoc khong"],
    expectedConclusion: "Phụ thuộc mục đích kinh doanh, nghĩa vụ thuế đầu ra và hồ sơ chứng minh.",
    anchors: ["48/2024/QH15", "181/2025/NĐ-CP"],
    mustNotInfer: "Không mặc nhiên loại hoặc chấp nhận toàn bộ chỉ vì là hàng biếu tặng.",
    safeRefusalWhen: "Thiếu chính sách tặng, đối tượng nhận và cách hạch toán thuế đầu ra.",
  },
  {
    id: "vat-import-late-declaration",
    category: "GTGT nhập khẩu",
    query: "Chứng từ nộp thuế GTGT nhập khẩu bị kê khai sót thì doanh nghiệp được kê khai bổ sung đến thời điểm nào?",
    variants: ["quen ke khai chung tu vat nhap khau thi bo sung luc nao"],
    expectedConclusion: "Xác định theo quy định khai bổ sung và thời điểm phát hiện sai sót.",
    anchors: ["108/2025/QH15", "252/2026/NĐ-CP", "181/2025/NĐ-CP"],
    mustNotInfer: "Không tự đặt thời hạn cố định nếu chưa đối chiếu kỳ khai và tình trạng kiểm tra.",
    safeRefusalWhen: "Chưa rõ kỳ kê khai và cơ quan thuế đã công bố quyết định kiểm tra hay chưa.",
  },
  {
    id: "vat-import-trust-import",
    category: "GTGT nhập khẩu",
    query: "Doanh nghiệp nhập khẩu ủy thác thì bên nào được khấu trừ thuế GTGT khâu nhập khẩu?",
    variants: ["nhap khau uy thac ben giao hay ben nhan duoc khau tru vat"],
    expectedConclusion: "Phải xác định chủ thể đứng tên, chứng từ và quan hệ ủy thác theo trường hợp cụ thể.",
    anchors: ["181/2025/NĐ-CP"],
    mustNotInfer: "Không cho cả hai bên cùng khấu trừ một khoản thuế.",
    safeRefusalWhen: "Thiếu hợp đồng ủy thác, tờ khai hải quan và chứng từ nộp thuế.",
  },
  {
    id: "vat-refund-investment",
    category: "Hoàn thuế GTGT",
    query: "Dự án đầu tư đang xây dựng có số thuế đầu vào chưa khấu trừ hết thì điều kiện hoàn thuế là gì?",
    variants: ["du an dau tu dang xay dung dieu kien hoan vat"],
    expectedConclusion: "Kiểm tra dự án, giai đoạn đầu tư, số thuế lũy kế và điều kiện hồ sơ.",
    anchors: ["48/2024/QH15", "181/2025/NĐ-CP", "144/2026/NĐ-CP"],
    mustNotInfer: "Không suy ra được hoàn chỉ vì có số thuế đầu vào lớn.",
    safeRefusalWhen: "Thiếu giấy phép đầu tư, kỳ hoàn và tình trạng hoạt động của dự án.",
  },
  {
    id: "vat-refund-export",
    category: "Hoàn thuế GTGT",
    query: "Doanh nghiệp xuất khẩu có thuế GTGT đầu vào chưa khấu trừ hết thì được hoàn trong trường hợp nào?",
    variants: ["xuat khau con vat dau vao thi hoan the nao"],
    expectedConclusion: "Phải đáp ứng điều kiện xuất khẩu, thanh toán và ngưỡng hoàn theo quy định hiện hành.",
    anchors: ["48/2024/QH15", "181/2025/NĐ-CP"],
    mustNotInfer: "Không coi mọi doanh thu xuất khẩu là đủ điều kiện hoàn.",
    safeRefusalWhen: "Thiếu hợp đồng, tờ khai hải quan, chứng từ thanh toán và dữ liệu thuế đầu vào.",
  },
  {
    id: "vat-refund-offset",
    category: "Hoàn thuế GTGT",
    query: "Khoản thuế GTGT được hoàn có phải bù trừ với nghĩa vụ thuế đang nợ trước khi chi hoàn không?",
    variants: ["tien hoan vat co bu tru no thue truoc khong"],
    expectedConclusion: "Đối chiếu quy định bù trừ nghĩa vụ và tình trạng khoản nợ.",
    anchors: ["108/2025/QH15", "252/2026/NĐ-CP"],
    mustNotInfer: "Không tự động coi mọi khoản đang hiển thị là nợ được bù trừ.",
    safeRefusalWhen: "Chưa xác định khoản nợ, khoản nộp thừa và quyết định hoàn.",
  },
  {
    id: "vat-refund-risk-invoice",
    category: "Hoàn thuế GTGT",
    query: "Hồ sơ hoàn thuế có hóa đơn của doanh nghiệp bỏ địa chỉ kinh doanh thì xử lý thế nào?",
    variants: ["hoan thue co hoa don cua cong ty bo dia chi xu ly sao"],
    expectedConclusion: "Xác minh giao dịch và hóa đơn; không tự động bác toàn bộ hồ sơ chỉ từ trạng thái người bán.",
    anchors: ["108/2025/QH15", "252/2026/NĐ-CP"],
    mustNotInfer: "Không suy ra hóa đơn giả chỉ từ trạng thái địa chỉ.",
    safeRefusalWhen: "Không có hồ sơ giao nhận, thanh toán và kết quả xác minh giao dịch.",
  },
  {
    id: "cit-prepaid-expense",
    category: "Thuế TNDN",
    query: "Khoản chi phí trích trước chưa có hóa đơn đến cuối năm có được tính vào chi phí được trừ không?",
    variants: ["trich truoc chi phi chua co hoa don co duoc tru tndn"],
    expectedConclusion: "Phụ thuộc căn cứ trích trước, thời điểm phát sinh và việc điều chỉnh khi chi phí thực tế khác.",
    anchors: ["Luật Thuế TNDN hiện hành", "320/2025/NĐ-CP"],
    mustNotInfer: "Không chấp nhận chỉ vì đã hạch toán kế toán.",
    safeRefusalWhen: "Thiếu hợp đồng, dự toán, thời điểm hoàn thành và chứng từ phát sinh thực tế.",
  },
  {
    id: "cit-related-party-interest",
    category: "Thuế TNDN",
    query: "Doanh nghiệp có giao dịch liên kết thì giới hạn chi phí lãi vay được trừ xác định thế nào?",
    variants: ["giao dich lien ket gioi han lai vay duoc tru"],
    expectedConclusion: "Phải xác định EBITDA thuế, khoản lãi vay ròng và ngoại lệ theo kỳ.",
    anchors: ["Quy định giao dịch liên kết hiện hành", "Luật Thuế TNDN hiện hành"],
    mustNotInfer: "Không áp tỷ lệ giới hạn khi chưa xác định doanh nghiệp có giao dịch liên kết.",
    safeRefusalWhen: "Thiếu quan hệ liên kết và số liệu lãi vay, lãi tiền gửi, EBITDA.",
  },
  {
    id: "cit-provision",
    category: "Thuế TNDN",
    query: "Khoản dự phòng nợ phải thu khó đòi cần điều kiện gì để được tính vào chi phí được trừ?",
    variants: ["du phong no kho doi dieu kien chi phi tndn"],
    expectedConclusion: "Phải đúng đối tượng, hồ sơ, mức trích và thời điểm theo quy định.",
    anchors: ["Luật Thuế TNDN hiện hành", "Thông tư về dự phòng hiện hành"],
    mustNotInfer: "Không coi mọi khoản quá hạn là nợ khó đòi đủ điều kiện.",
    safeRefusalWhen: "Thiếu hợp đồng, đối chiếu công nợ, thời gian quá hạn và biện pháp thu hồi.",
  },
  {
    id: "cit-exchange-rate",
    category: "Thuế TNDN",
    query: "Lỗ chênh lệch tỷ giá cuối năm của khoản phải thu có được tính vào chi phí được trừ không?",
    variants: ["lo ty gia cuoi nam khoan phai thu co duoc tru tndn"],
    expectedConclusion: "Phân biệt đánh giá lại khoản mục tiền tệ và chênh lệch đã thực hiện.",
    anchors: ["Luật Thuế TNDN hiện hành", "Chế độ tài chính doanh nghiệp hiện hành"],
    mustNotInfer: "Không gộp mọi chênh lệch tỷ giá vào một cách xử lý.",
    safeRefusalWhen: "Chưa rõ loại khoản mục, đồng tiền và thời điểm ghi nhận.",
  },
  {
    id: "cit-loss-transfer",
    category: "Thuế TNDN",
    query: "Doanh nghiệp vừa có hoạt động ưu đãi vừa có hoạt động không ưu đãi thì chuyển lỗ giữa các hoạt động thế nào?",
    variants: ["chuyen lo giua hoat dong uu dai va khong uu dai tndn"],
    expectedConclusion: "Hạch toán riêng và chuyển lỗ theo đúng nguồn hoạt động, ngoại lệ phải có căn cứ.",
    anchors: ["Luật Thuế TNDN hiện hành", "320/2025/NĐ-CP"],
    mustNotInfer: "Không tự bù trừ toàn bộ giữa các mức ưu đãi khác nhau.",
    safeRefusalWhen: "Không có số liệu hạch toán riêng theo từng hoạt động.",
  },
  {
    id: "pit-residency",
    category: "Thuế TNCN",
    query: "Người nước ngoài ở Việt Nam dưới 183 ngày nhưng có nơi ở thường xuyên thì xác định cá nhân cư trú thế nào?",
    variants: ["nguoi nuoc ngoai duoi 183 ngay co nha thue la ca nhan cu tru khong"],
    expectedConclusion: "Phải xét đồng thời số ngày, nơi ở thường xuyên và chứng minh cư trú tại nước khác.",
    anchors: ["Luật Thuế TNCN hiện hành", "Văn bản hướng dẫn cư trú hiện hành"],
    mustNotInfer: "Không chỉ dựa duy nhất số ngày hiện diện.",
    safeRefusalWhen: "Thiếu lịch xuất nhập cảnh, hợp đồng thuê và giấy chứng nhận cư trú nước ngoài.",
  },
  {
    id: "pit-finalization-authorization",
    category: "Thuế TNCN",
    query: "Cá nhân có thu nhập hai nơi nhưng nơi thứ hai khấu trừ 10% thì có được ủy quyền quyết toán không?",
    variants: ["thu nhap 2 noi noi phu khau tru 10 phan tram uy quyen quyet toan duoc khong"],
    expectedConclusion: "Phụ thuộc tính chất thu nhập vãng lai, mức bình quân và nhu cầu quyết toán phần đó.",
    anchors: ["Luật Thuế TNCN hiện hành", "Văn bản quản lý thuế hiện hành"],
    mustNotInfer: "Không mặc nhiên cho ủy quyền chỉ vì đã khấu trừ 10%.",
    safeRefusalWhen: "Thiếu loại hợp đồng và tổng thu nhập bình quân tại nơi thứ hai.",
  },
  {
    id: "pit-dependent",
    category: "Thuế TNCN",
    query: "Người phụ thuộc đăng ký muộn thì được tính giảm trừ từ tháng phát sinh nghĩa vụ nuôi dưỡng hay từ tháng đăng ký?",
    variants: ["dang ky nguoi phu thuoc muon tinh giam tru tu thang nao"],
    expectedConclusion: "Phân biệt khai tạm tính và quyết toán, đồng thời kiểm tra hồ sơ chứng minh.",
    anchors: ["Luật Thuế TNCN hiện hành", "Thông tư hướng dẫn giảm trừ gia cảnh hiện hành"],
    mustNotInfer: "Không cho giảm trừ khi trùng đăng ký hoặc thiếu điều kiện phụ thuộc.",
    safeRefusalWhen: "Thiếu quan hệ, thu nhập người phụ thuộc và thời điểm phát sinh nuôi dưỡng.",
  },
  {
    id: "pit-benefit-in-kind",
    category: "Thuế TNCN",
    query: "Công ty trả tiền thuê nhà cho người lao động thì phần nào tính vào thu nhập chịu thuế TNCN?",
    variants: ["cong ty tra tien nha cho nhan vien tinh tncn the nao"],
    expectedConclusion: "Áp giới hạn và điều kiện theo khoản lợi ích nhà ở, không mặc nhiên tính toàn bộ hoặc miễn toàn bộ.",
    anchors: ["Luật Thuế TNCN hiện hành", "Văn bản hướng dẫn thu nhập chịu thuế hiện hành"],
    mustNotInfer: "Không áp giới hạn khi chưa xác định thu nhập chưa gồm tiền nhà.",
    safeRefusalWhen: "Thiếu tiền lương chịu thuế và số tiền nhà thực trả.",
  },
  {
    id: "invoice-returned-goods",
    category: "Hóa đơn điện tử",
    query: "Khách hàng trả lại một phần hàng hóa thì người bán lập hóa đơn điều chỉnh hay người mua lập hóa đơn trả lại?",
    variants: ["tra lai mot phan hang lap hoa don the nao"],
    expectedConclusion: "Xác định theo vai trò người bán/người mua và quy định hóa đơn hiện hành, tránh dùng quy trình cũ.",
    anchors: ["254/2026/NĐ-CP", "91/2026/TT-BTC"],
    mustNotInfer: "Không áp một cách xử lý cho mọi trường hợp người mua là doanh nghiệp hoặc cá nhân.",
    safeRefusalWhen: "Thiếu loại người mua và việc hàng đã nhập kho, thanh toán hay chưa.",
  },
  {
    id: "invoice-discount",
    category: "Hóa đơn điện tử",
    query: "Chiết khấu thương mại căn cứ doanh số cuối kỳ thì lập hóa đơn điều chỉnh cho từng hóa đơn hay một hóa đơn tổng?",
    variants: ["chiet khau doanh so cuoi ky lap hoa don dieu chinh sao"],
    expectedConclusion: "Đối chiếu phương thức chiết khấu trong hợp đồng và quy định lập hóa đơn kỳ hiện hành.",
    anchors: ["254/2026/NĐ-CP", "91/2026/TT-BTC"],
    mustNotInfer: "Không chọn hóa đơn tổng nếu hợp đồng và dữ liệu không hỗ trợ.",
    safeRefusalWhen: "Thiếu kỳ chiết khấu, danh sách hóa đơn và thỏa thuận thương mại.",
  },
  {
    id: "invoice-wrong-tax-rate",
    category: "Hóa đơn điện tử",
    query: "Hóa đơn điện tử ghi sai thuế suất làm tăng tiền thuế thì xử lý điều chỉnh hay thay thế?",
    variants: ["hoa don sai thue suat tang tien thue dieu chinh hay thay the"],
    expectedConclusion: "Chọn phương thức theo quy định sai sót và bảo đảm liên kết hóa đơn gốc.",
    anchors: ["254/2026/NĐ-CP", "91/2026/TT-BTC"],
    mustNotInfer: "Không đồng thời vừa điều chỉnh vừa thay thế cùng một sai sót.",
    safeRefusalWhen: "Chưa rõ hóa đơn đã gửi người mua và đã kê khai hay chưa.",
  },
  {
    id: "invoice-timing-service",
    category: "Hóa đơn điện tử",
    query: "Dịch vụ thu tiền trước nhưng hoàn thành sau thì thời điểm lập hóa đơn xác định thế nào?",
    variants: ["thu tien truoc dich vu lap hoa don luc nao"],
    expectedConclusion: "Phân biệt khoản thu trước, đặt cọc và thời điểm cung cấp dịch vụ theo loại dịch vụ.",
    anchors: ["254/2026/NĐ-CP"],
    mustNotInfer: "Không coi mọi khoản tiền nhận trước đều là doanh thu phải lập hóa đơn ngay.",
    safeRefusalWhen: "Thiếu loại dịch vụ và bản chất khoản tiền nhận.",
  },
  {
    id: "invoice-authorization",
    category: "Hóa đơn điện tử",
    query: "Doanh nghiệp ủy nhiệm cho sàn thương mại điện tử lập hóa đơn thì trách nhiệm dữ liệu thuộc về bên nào?",
    variants: ["uy nhiem san tmdt lap hoa don ai chiu trach nhiem"],
    expectedConclusion: "Phân định trách nhiệm người bán, bên nhận ủy nhiệm và truyền dữ liệu theo thỏa thuận hợp lệ.",
    anchors: ["254/2026/NĐ-CP", "91/2026/TT-BTC"],
    mustNotInfer: "Không chuyển toàn bộ trách nhiệm thuế cho bên nhận ủy nhiệm.",
    safeRefusalWhen: "Thiếu hợp đồng ủy nhiệm và mô hình phát hành hóa đơn.",
  },
  {
    id: "tax-admin-zero-debt-cessation",
    category: "Quản lý thuế và mã số thuế",
    query: "Người nộp thuế không còn nợ nhưng chưa hoàn thành chấm dứt hiệu lực mã số thuế thì có xác nhận hoàn thành nghĩa vụ không?",
    variants: ["khong con no nhung chua cham dut max so thue co xac nhan khong"],
    expectedConclusion: "Số dư nợ bằng 0 không đồng nghĩa đã hoàn thành toàn bộ thủ tục và nghĩa vụ.",
    anchors: ["108/2025/QH15", "252/2026/NĐ-CP", "90/2026/TT-BTC"],
    mustNotInfer: "Không ghi còn nợ khi số liệu nợ bằng 0; phải nêu đúng thủ tục còn thiếu.",
    safeRefusalWhen: "Chưa biết loại giấy xác nhận và nghĩa vụ cụ thể chưa hoàn tất.",
  },
  {
    id: "tax-admin-inactive-address",
    category: "Quản lý thuế và mã số thuế",
    query: "Người nộp thuế không hoạt động tại địa chỉ đăng ký nhưng không nợ thuế thì có được xác nhận không nợ không?",
    variants: ["nguoi nop thue trang tai khong hoat dong tai dia chi dang ky khong no thue"],
    expectedConclusion: "Trạng thái địa chỉ không tự chứng minh có nợ; phải phân biệt xác nhận số dư nợ và hoàn thành toàn bộ nghĩa vụ.",
    anchors: ["108/2025/QH15", "252/2026/NĐ-CP", "90/2026/TT-BTC"],
    mustNotInfer: "Không từ chối chỉ bằng tên trạng thái mà không nêu nghĩa vụ còn thiếu.",
    safeRefusalWhen: "Chưa rõ mục đích xác nhận và hồ sơ khai, hóa đơn, vi phạm còn tồn tại.",
  },
  {
    id: "tax-admin-overpayment-offset",
    category: "Quản lý thuế và mã số thuế",
    query: "Người nộp thuế vừa có khoản nộp thừa vừa có khoản nợ ở địa bàn khác thì bù trừ thế nào?",
    variants: ["nop thua mot noi no thue noi khac bu tru sao"],
    expectedConclusion: "Xác định cùng người nộp thuế, loại nghĩa vụ và thứ tự bù trừ theo hệ thống quản lý.",
    anchors: ["108/2025/QH15", "252/2026/NĐ-CP"],
    mustNotInfer: "Không bù trừ giữa các chủ thể hoặc khoản không đủ điều kiện.",
    safeRefusalWhen: "Thiếu mã nghĩa vụ, cơ quan quản lý và trạng thái khoản nợ/nộp thừa.",
  },
  {
    id: "tax-admin-enforcement",
    category: "Quản lý thuế và mã số thuế",
    query: "Doanh nghiệp đang khiếu nại quyết định ấn định thuế thì có bị cưỡng chế khoản tiền đó không?",
    variants: ["khieu nai an dinh thue co bi cuong che khong"],
    expectedConclusion: "Phải đối chiếu hiệu lực quyết định, nghĩa vụ nộp trong thời gian khiếu nại và quyết định tạm đình chỉ nếu có.",
    anchors: ["108/2025/QH15", "252/2026/NĐ-CP"],
    mustNotInfer: "Không coi việc khiếu nại tự động dừng mọi biện pháp cưỡng chế.",
    safeRefusalWhen: "Thiếu quyết định, thời hạn nộp và văn bản tạm đình chỉ.",
  },
  {
    id: "tax-admin-dependent-unit",
    category: "Quản lý thuế và mã số thuế",
    query: "Công ty mẹ chấm dứt mã số thuế khi chi nhánh còn nghĩa vụ khai thuế thì xử lý thế nào?",
    variants: ["cong ty me dong mst chi nhanh con to khai xu ly sao"],
    expectedConclusion: "Phải hoàn tất hoặc chuyển giao nghĩa vụ của đơn vị phụ thuộc trước khi hoàn tất chấm dứt.",
    anchors: ["90/2026/TT-BTC", "252/2026/NĐ-CP"],
    mustNotInfer: "Không chấm dứt độc lập mà bỏ sót nghĩa vụ đơn vị phụ thuộc.",
    safeRefusalWhen: "Chưa xác định trạng thái và nghĩa vụ từng chi nhánh.",
  },
  {
    id: "fct-software-service",
    category: "Nhà thầu nước ngoài và thương mại điện tử",
    query: "Công ty Việt Nam mua phần mềm kèm dịch vụ hỗ trợ của nhà cung cấp nước ngoài thì thuế nhà thầu tính thế nào?",
    variants: ["mua software kem support nuoc ngoai tinh fct sao"],
    expectedConclusion: "Tách bản quyền, dịch vụ và hàng hóa nếu hợp đồng cho phép; xác định phương pháp nộp của nhà thầu.",
    anchors: ["Quy định thuế nhà thầu hiện hành", "Luật Thuế GTGT hiện hành", "Luật Thuế TNDN hiện hành"],
    mustNotInfer: "Không áp một tỷ lệ cho toàn bộ hợp đồng khi các cấu phần tách được.",
    safeRefusalWhen: "Thiếu hợp đồng, quyền sử dụng và nơi thực hiện dịch vụ.",
  },
  {
    id: "ecommerce-platform-withholding",
    category: "Nhà thầu nước ngoài và thương mại điện tử",
    query: "Sàn thương mại điện tử nước ngoài thu tiền hộ người bán Việt Nam thì bên nào kê khai và nộp thuế?",
    variants: ["san tmdt nuoc ngoai thu ho ai nop thue cho nguoi ban viet nam"],
    expectedConclusion: "Xác định trách nhiệm khấu trừ/nộp thay theo mô hình thanh toán và chủ thể nền tảng.",
    anchors: ["108/2025/QH15", "252/2026/NĐ-CP"],
    mustNotInfer: "Không mặc nhiên miễn nghĩa vụ của người bán khi nền tảng không thuộc diện khấu trừ.",
    safeRefusalWhen: "Thiếu luồng thanh toán và tư cách pháp lý của nền tảng.",
  },
  {
    id: "cross-border-advertising",
    category: "Nhà thầu nước ngoài và thương mại điện tử",
    query: "Doanh nghiệp mua quảng cáo trực tuyến của nền tảng nước ngoài đã tự đăng ký thuế tại Việt Nam thì có phải khấu trừ thuế nhà thầu nữa không?",
    variants: ["mua ads nha cung cap nuoc ngoai da dang ky thue co khau tru fct khong"],
    expectedConclusion: "Kiểm tra cơ chế nhà cung cấp tự khai, chứng từ và trách nhiệm của bên mua theo từng khoản thuế.",
    anchors: ["108/2025/QH15", "252/2026/NĐ-CP"],
    mustNotInfer: "Không suy ra đã đăng ký là đã nộp đủ cho mọi giao dịch.",
    safeRefusalWhen: "Thiếu mã số thuế nhà cung cấp, hóa đơn/chứng từ và kỳ giao dịch.",
  },
  {
    id: "excise-combo-product",
    category: "Thuế khác",
    query: "Sản phẩm bán theo combo có một hàng hóa chịu thuế tiêu thụ đặc biệt thì giá tính thuế xác định thế nào?",
    variants: ["combo co hang chiu ttdb tinh gia thue sao"],
    expectedConclusion: "Phải phân bổ giá và xác định đúng hàng hóa chịu thuế theo giao dịch thực tế.",
    anchors: ["Luật Thuế tiêu thụ đặc biệt hiện hành"],
    mustNotInfer: "Không áp thuế cho toàn bộ combo nếu có căn cứ tách riêng.",
    safeRefusalWhen: "Thiếu bảng giá, hợp đồng và cách ghi hóa đơn.",
  },
  {
    id: "resource-tax-loss",
    category: "Thuế khác",
    query: "Tài nguyên khai thác bị hao hụt trong định mức thì sản lượng tính thuế tài nguyên xác định thế nào?",
    variants: ["hao hut tai nguyen trong dinh muc tinh thue ra sao"],
    expectedConclusion: "Đối chiếu sản lượng thực tế, định mức được chấp nhận và phương pháp đo đếm.",
    anchors: ["Luật Thuế tài nguyên hiện hành"],
    mustNotInfer: "Không tự trừ mọi hao hụt khai báo.",
    safeRefusalWhen: "Thiếu định mức, hồ sơ đo đếm và loại tài nguyên.",
  },
  {
    id: "land-rent-project-transfer",
    category: "Thuế khác",
    query: "Chuyển nhượng dự án đang được miễn tiền thuê đất thì bên nhận có tiếp tục được miễn không?",
    variants: ["chuyen nhuong du an dang mien tien thue dat ben mua co duoc mien tiep"],
    expectedConclusion: "Phụ thuộc điều kiện ưu đãi, quyết định thuê đất và việc kế thừa dự án.",
    anchors: ["Pháp luật đất đai và tiền thuê đất hiện hành"],
    mustNotInfer: "Không coi ưu đãi tự động chuyển theo tài sản.",
    safeRefusalWhen: "Thiếu quyết định đầu tư, thuê đất và nội dung chuyển nhượng.",
  },
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
    assert.ok(result.candidates.some((item) => item.number === "48/2024/QH15"));
    assert.ok(result.candidates.some((item) => item.number === "181/2025/NĐ-CP"));
    assert.ok(result.candidates.some((item) => item.number === "144/2026/NĐ-CP"));
  }
});

test("unfinished tax-id cessation distinguishes zero debt from completed obligations and repairs max typo", () => {
  for (const query of [
    "Trường hợp người nộp thuế không còn nợ thuế nhưng chưa hoàn thành thủ tục chấm dứt hiệu lực mã số thuế thì từ chối xác nhận không nợ theo quy định nào?",
    "nguoi nop thue khong con no nhung chua hoan thanh cham dut hieu luc max so thue thi tu choi xac nhan khong no theo quy dinh nao",
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

test("advanced catalog covers the main tax practice areas and preserves safety metadata", () => {
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
  ]) {
    assert.ok(categories.has(category), `Missing category: ${category}`);
  }
  for (const item of ADVANCED_QUESTION_CATALOG) {
    assert.ok(item.id && item.query && item.expectedConclusion);
    assert.ok(item.variants.length >= 1, `${item.id} needs a natural variant`);
    assert.ok(item.anchors.length >= 1, `${item.id} needs a legal anchor`);
    assert.ok(item.mustNotInfer.length >= 20, `${item.id} needs an anti-inference rule`);
    assert.ok(item.safeRefusalWhen.length >= 20, `${item.id} needs a safe-refusal condition`);
  }
});

test("question intelligence recognizes representative advanced queries and typo variants", () => {
  const imported = analyzeTaxQuestion(ADVANCED_QUESTION_CATALOG[0].query);
  assert.equal(imported.isQuestion, true);
  assert.ok(imported.taxAreas.includes("thuế xuất nhập khẩu"));
  assert.ok(imported.intents.includes("khấu trừ thuế, chi phí được trừ"));

  const typoDebt = analyzeTaxQuestion("khong con no thue nhung chua cham dut max so thue thi co xac nhan khong");
  assert.equal(typoDebt.isQuestion, true);
});
