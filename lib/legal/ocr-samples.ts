export type OcrSample = {
  label: string;
  description: string;
  url: string;
  pages: number;
  testPages: number[];
  cases: string[];
};

export const OCR_SAMPLES: OcrSample[] = [
  {
    label: "273/2026/NĐ-CP",
    description: "66 trang · văn bản ký số dài, nhiều bảng đánh giá kéo dài qua nhiều trang",
    url: "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/7/273-m-ndcp.signed.pdf",
    pages: 66,
    testPages: [12, 13, 14],
    cases: ["bảng 6 cột", "bảng qua trang", "checkbox"],
  },
  {
    label: "11/2026/TT-BKHCN",
    description: "28 trang · có phụ lục, bảng, biểu mẫu, con dấu và dòng chấm",
    url: "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/4/11-bkhcn.pdf",
    pages: 28,
    testPages: [4, 6, 9, 12, 13],
    cases: ["biểu mẫu", "bảng 5 cột", "dòng điền"],
  },
  {
    label: "237/2026/NĐ-CP",
    description: "38 trang · nghị định dài, nhiều Điều và phụ lục",
    url: "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/6/237-ndcp.signed.pdf",
    pages: 38,
    testPages: [1, 37, 38],
    cases: ["mở đầu", "phụ lục cuối tệp"],
  },
  {
    label: "197/2026/NĐ-CP",
    description: "19 trang · nghị định ký số, bố cục văn bản hành chính chuẩn",
    url: "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/6/1972026-ndcp.signed.pdf",
    pages: 19,
    testPages: [1, 18, 19],
    cases: ["văn bản chuẩn", "trang ký"],
  },
  {
    label: "68/2026/TT-BTC",
    description: "12 trang · thông tư Bộ Tài chính, nhiều viện dẫn và Điều/Khoản",
    url: "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/6/68-btc.signed.pdf",
    pages: 12,
    testPages: [1, 11, 12],
    cases: ["viện dẫn", "trang cuối"],
  },
  {
    label: "11/2026/QĐ-TTg",
    description: "14 trang · quyết định kèm danh mục dữ liệu quốc gia",
    url: "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/3/11-ttg.signed.pdf",
    pages: 14,
    testPages: [1, 13, 14],
    cases: ["danh mục", "bảng cuối tệp"],
  },
  {
    label: "63/2026/NĐ-CP",
    description: "15 trang · PDF không dùng hậu tố signed, kiểm tra biến thể nguồn",
    url: "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/3/63-ndcp2026.pdf",
    pages: 15,
    testPages: [1, 14, 15],
    cases: ["biến thể URL", "trang cuối"],
  },
];
