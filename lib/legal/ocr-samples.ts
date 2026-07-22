export type OcrSample = {
  label: string;
  description: string;
  url: string;
  pages: number;
};

export const OCR_SAMPLES: OcrSample[] = [
  {
    label: "273/2026/NĐ-CP",
    description: "66 trang · văn bản ký số dài, dùng để thử phản hồi rỗng và chạy toàn tệp",
    url: "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/7/273-m-ndcp.signed.pdf",
    pages: 66,
  },
  {
    label: "11/2026/TT-BKHCN",
    description: "28 trang · có phụ lục, bảng, biểu mẫu, con dấu và dòng chấm",
    url: "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/4/11-bkhcn.pdf",
    pages: 28,
  },
  {
    label: "237/2026/NĐ-CP",
    description: "38 trang · nghị định dài, nhiều Điều và phụ lục",
    url: "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/6/237-ndcp.signed.pdf",
    pages: 38,
  },
  {
    label: "197/2026/NĐ-CP",
    description: "19 trang · nghị định ký số, bố cục văn bản hành chính chuẩn",
    url: "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/6/1972026-ndcp.signed.pdf",
    pages: 19,
  },
  {
    label: "68/2026/TT-BTC",
    description: "12 trang · thông tư Bộ Tài chính",
    url: "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/6/68-btc.signed.pdf",
    pages: 12,
  },
  {
    label: "11/2026/QĐ-TTg",
    description: "14 trang · quyết định kèm danh mục dữ liệu quốc gia",
    url: "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/3/11-ttg.signed.pdf",
    pages: 14,
  },
  {
    label: "63/2026/NĐ-CP",
    description: "15 trang · PDF không dùng hậu tố signed, kiểm tra biến thể nguồn",
    url: "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/3/63-ndcp2026.pdf",
    pages: 15,
  },
];
