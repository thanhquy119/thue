export type OcrFormatFixture = {
  id: string;
  label: string;
  description: string;
  risks: string[];
  pages: Array<{ page: number; text: string }>;
};

export const OCR_FORMAT_FIXTURES: OcrFormatFixture[] = [
  {
    id: "standard-decree",
    label: "Nghị định · phần mở đầu chuẩn",
    description: "Kiểm tra hai cột quốc hiệu, số hiệu, ngày ban hành, tên văn bản nhiều dòng và Điều/Khoản/Điểm.",
    risks: ["phần mở đầu", "tiêu đề nhiều dòng", "Điều/Khoản/Điểm"],
    pages: [
      {
        page: 1,
        text: `
CHÍNH PHỦ
CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
Số: 141/2026/NĐ-CP
Hà Nội, ngày 29 tháng 4 năm 2026
NGHỊ ĐỊNH
Sửa đổi, bổ sung một số điều của Nghị định số 68/2026/NĐ-CP
quy định về chính sách thuế đối với hộ kinh doanh, cá nhân kinh doanh
Căn cứ Luật Tổ chức Chính phủ số 63/2025/QH15;
Căn cứ Luật Quản lý thuế số 38/2019/QH14;
Theo đề nghị của Bộ trưởng Bộ Tài chính;
Chính phủ ban hành Nghị định sửa đổi, bổ sung một số điều của Nghị định số 68/2026/NĐ-CP.
Điều 1. Sửa đổi, bổ sung một số điều của Nghị định số 68/2026/NĐ-CP
1. Sửa đổi cụm từ “500 triệu đồng” thành “01 tỷ đồng”.
a) Hộ kinh doanh có doanh thu năm trên 01 tỷ đồng phải áp dụng hóa đơn điện tử.
b) Trường hợp doanh thu từ 01 tỷ đồng trở xuống thì được đăng ký sử dụng theo nhu cầu.
`,
      },
      {
        page: 2,
        text: `
Điều 2. Điều khoản thi hành
1. Nghị định này có hiệu lực thi hành từ ngày 01 tháng 7 năm 2026.
2. Bộ trưởng Bộ Tài chính chịu trách nhiệm hướng dẫn thi hành Nghị định này.
`,
      },
    ],
  },
  {
    id: "split-ministry-preamble",
    label: "Thông tư · dòng đầu bị tách",
    description: "Mô phỏng OCR tách BỘ/TÀI CHÍNH, quốc hiệu, tiêu ngữ và số hiệu thành nhiều dòng.",
    risks: ["cơ quan bị tách", "quốc hiệu bị tách", "địa danh khác Hà Nội"],
    pages: [
      {
        page: 1,
        text: `
BỘ
TÀI CHÍNH
CỘNG HÒA XÃ HỘI
CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do
- Hạnh phúc
Số:
88/2026/TT-BTC
Đà Nẵng, ngày 15 tháng 6 năm 2026
THÔNG TƯ
Hướng dẫn quản lý, sử dụng hóa đơn điện tử
đối với hộ kinh doanh và cá nhân kinh doanh
Căn cứ Luật Quản lý thuế;
Theo đề nghị của Cục trưởng Cục Thuế;
Bộ trưởng Bộ Tài chính ban hành Thông tư hướng dẫn quản lý, sử dụng hóa đơn điện tử.
Điều 1 Phạm vi điều chỉnh
Thông tư này hướng dẫn việc đăng ký, lập và sử dụng hóa đơn điện tử.
Điều 2 Đối tượng áp dụng
1. Hộ kinh doanh, cá nhân kinh doanh.
2. Cơ quan thuế và tổ chức cung cấp dịch vụ hóa đơn điện tử.
`,
      },
    ],
  },
  {
    id: "continued-six-column-table",
    label: "Bảng 6 cột · qua nhiều trang",
    description: "Kiểm tra hàng bị cắt, lặp tiêu đề ở trang mới, ô Đạt/Không đạt và cột nhận xét để trống.",
    risks: ["bảng tiếp nối", "hàng bị cắt", "checkbox", "lặp tiêu đề"],
    pages: [
      {
        page: 12,
        text: `
II. NHẬN XÉT, ĐÁNH GIÁ THEO TIÊU CHÍ THẨM ĐỊNH
| STT | Nội dung tiêu chí | Đạt | Không đạt | Nhận xét/đánh giá | Yêu cầu giải trình/bổ sung |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Có phương án, quy trình công nghệ được mô tả rõ ràng | □ | □ | | |
| 2 | Có một hoặc một số yếu tố kỹ thuật để thực hiện phương án công |
`,
      },
      {
        page: 13,
        text: `
nghệ, giải pháp kỹ thuật quy định tại khoản 1 Điều 12 Nghị định số 101/2026/NĐ-CP
| STT | Nội dung tiêu chí | Đạt | Không đạt | Nhận xét/đánh giá | Yêu cầu giải trình/bổ sung |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 3 | Có khả năng tạo ra sản phẩm, dịch vụ hoặc kết quả cụ thể | ☑ | □ | Đủ căn cứ | |
| 4 | Không thuộc Danh mục công nghệ cấm chuyển giao | □ | ☑ | | Bổ sung tài liệu |
`,
      },
    ],
  },
  {
    id: "forms-and-checkboxes",
    label: "Biểu mẫu · trường điền và ô chọn",
    description: "Kiểm tra tiêu đề phụ lục, dòng chấm, trường Kính gửi, danh sách lựa chọn và bảng danh mục mẫu.",
    risks: ["dòng chấm", "trường điền", "ô lựa chọn", "bảng 2 cột"],
    pages: [
      {
        page: 4,
        text: `
PHỤ LỤC I
ĐƠN ĐỀ NGHỊ THẨM ĐỊNH CÔNG NGHỆ
Kính gửi: ................................................................................
1. Tên tổ chức/cá nhân: .................................................................
2. Mã số thuế: ...........................................................................
□ Công nghệ do tổ chức, cá nhân nghiên cứu tạo ra
☑ Công nghệ đã được lựa chọn để đầu tư
Ghi chú: Đánh dấu vào ô phù hợp và cung cấp tài liệu chứng minh kèm theo.
| Mẫu số 01 | Đơn đề nghị thẩm định công nghệ trong trường hợp đặc thù |
| Mẫu số 02 | Thuyết minh công nghệ đề nghị thẩm định |
| Mẫu số 03 | Thông báo dự toán kinh phí thẩm định công nghệ |
`,
      },
    ],
  },
  {
    id: "mid-document-selection",
    label: "Đoạn giữa văn bản · không có trang 1",
    description: "Kiểm tra preview trang cụ thể không bị nhận nhầm là phần mở đầu và vẫn tách Điều không có dấu chấm.",
    risks: ["bắt đầu giữa văn bản", "Điều không dấu chấm", "nội dung nối trang"],
    pages: [
      {
        page: 7,
        text: `
3. Hồ sơ đăng ký được gửi bằng phương thức điện tử.
c) Trường hợp hệ thống gặp sự cố, người nộp thuế được nộp bổ sung trong ngày làm việc tiếp theo.
Điều 4 Trách nhiệm của cơ quan thuế
1. Tiếp nhận và xử lý hồ sơ theo đúng thời hạn.
2. Thông báo cho người nộp thuế khi hồ sơ chưa đầy đủ.
`,
      },
      {
        page: 8,
        text: `
Điều 5. Trách nhiệm của người nộp thuế
Người nộp thuế chịu trách nhiệm về tính chính xác của thông tin đã kê khai.
`,
      },
    ],
  },
];
