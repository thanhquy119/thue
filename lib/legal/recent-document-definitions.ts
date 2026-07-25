import { extractSearchHint, normalizeLegalQuery } from "./query.ts";

export type RecentDocumentDownload = {
  url: string;
  fileName: string;
  mimeType: string;
  referer: string;
  label: string;
  textStartMarker?: string;
  textEndMarker?: string;
};

export type RecentDocumentDefinition = {
  number: string;
  title: string;
  issuedDate: string;
  effectiveDate: string;
  officialPage: string;
  minimumTextLength: number;
  downloads: RecentDocumentDownload[];
  fullTextUnavailableReason?: string;
};

const DOCUMENTS: RecentDocumentDefinition[] = [
  {
    number: "108/2025/QH15",
    title: "Luật Quản lý thuế",
    issuedDate: "2025-12-10",
    effectiveDate: "2026-07-01",
    officialPage: "https://congbao.chinhphu.vn/van-ban/luat-so-108-2025-qh15-468670/61635.htm",
    minimumTextLength: 10_000,
    downloads: [
      {
        url: "https://g7.cdnchinhphu.vn/api/download/stream?Url=tm-8mq6BhNw0NbrKRhTDAaHMpvrqWaeHuYm7lW3HNfzTzww8Myg35dDL_fJB4izw4hPXncfHJQbhdCGlxb8TQvmvpGInXk1XW_EQtJ6G5fzHZ4Ju3kkVHLOdmjON8vyu&file_name=2026_38_108%2F2025%2FQH15.docx",
        fileName: "2026_38_108_2025_QH15.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        referer: "https://congbao.chinhphu.vn/van-ban/luat-so-108-2025-qh15-468670/61635.htm",
        label: "Bản DOCX chính thức từ Công báo điện tử Chính phủ",
      },
    ],
  },
  {
    number: "90/2026/TT-BTC",
    title: "Quy định về đăng ký thuế",
    issuedDate: "2026-06-30",
    effectiveDate: "2026-07-01",
    officialPage: "https://chinhphu.vn/?classid=1&docid=218839&pageid=27160&typegroupid=6",
    minimumTextLength: 10_000,
    downloads: [
      {
        url: "https://baocaotaichinh.vn/tintuc/download?file=1808559206thong-tu-so-90_2026_tt-btc.docx",
        fileName: "Thong tu so 90_2026_TT-BTC.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        referer:
          "https://baocaotaichinh.vn/thu-vien/thong-tu-so-90-2026-ttbtc-cua-bo-tai-chinh-quy-dinh-ve-dang-ky-thue-1178433928-429186",
        label: "Bản DOCX công bố lại đã đối chiếu với Cổng Chính phủ",
      },
    ],
  },
  {
    number: "91/2026/TT-BTC",
    title:
      "Quy định một số điều của Luật Quản lý thuế và Nghị định số 254/2026/NĐ-CP về hóa đơn điện tử, chứng từ điện tử",
    issuedDate: "2026-06-30",
    effectiveDate: "2026-07-01",
    officialPage:
      "https://xaydungchinhsach.chinhphu.vn/nhung-diem-moi-cua-nghi-dinh-254-2026-nd-cp-va-thong-tu-91-2026-tt-btc-ve-hoa-don-dien-tu-chung-tu-dien-tu-119260717143502375.htm",
    minimumTextLength: 5_000,
    downloads: [
      {
        url: "https://dulieuphapluat.vn/van-ban/thue-phi-le-phi-van-ban/thong-tu-912026tt-btc-huong-dan-luat-quan-ly-thue-va-nghi-dinh-2542026nd-cp-huong-dan-luat-quan-ly-thue-ve-hoa-don-dien-tu-chung-tu-dien-tu-do-bo-truong-bo-tai-chinh-ban-hanh-1389630.html",
        fileName: "Thong tu so 91_2026_TT-BTC.html",
        mimeType: "text/html",
        referer: "https://dulieuphapluat.vn/",
        label: "Bản HTML toàn văn công bố lại đã đối chiếu với nguồn Chính phủ",
        textStartMarker: "BỘ TÀI CHÍNH",
        textEndMarker: "Từ khóa:",
      },
      {
        url: "https://baocaotaichinh.vn/tintuc/download?file=1670286540thong-tu-so-91_2026_tt-btc.pdf",
        fileName: "Thong tu so 91_2026_TT-BTC.pdf",
        mimeType: "application/pdf",
        referer:
          "https://baocaotaichinh.vn/thu-vien/thong-tu-so-91-2026-ttbtc-cua-bo-tai-chinh-quy-dinh-mot-so-dieu-cua-luat-quan-ly-thue-va-nghi-dinh-254-2026-ndcp-cua-chinh-phu-quy-dinh-chi-tiet-mot-so-dieu-va-bien-phap-de-to-chuc-huong-dan-thi-hanh-luat-quan-ly-thue-so-108-2025-qh15-ve-hoa-don-dien-tu-chung-tu-dien-tu-1647512103-313179",
        label: "Bản PDF công bố lại đã đối chiếu với nguồn Chính phủ",
      },
    ],
  },
  {
    number: "94/2026/TT-BTC",
    title: "Quy định về quản lý tuân thủ, quản lý rủi ro trong quản lý thuế",
    issuedDate: "2026-07-01",
    effectiveDate: "2026-07-01",
    officialPage: "https://vanban.chinhphu.vn/?classid=1&docid=218894&orggroupid=4&pageid=27160",
    minimumTextLength: 5_000,
    downloads: [],
    fullTextUnavailableReason:
      "Tệp chính thức hiện là PDF scan khoảng 13 MB; OCR toàn văn vượt thời gian xử lý an toàn. Hệ thống chỉ hiển thị đúng hồ sơ và liên kết chính thức, không dùng phần giao diện trang làm toàn văn.",
  },
];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/\s+/g, "")
    .trim();
}

export function recentDocumentDefinitions() {
  return DOCUMENTS.map((document) => ({
    ...document,
    downloads: document.downloads.map((download) => ({ ...download })),
  }));
}

export function findRecentDocumentByNumber(number: string) {
  const expected = normalize(number);
  return DOCUMENTS.find((document) => normalize(document.number) === expected) ?? null;
}

export function findRecentDocumentForQuery(query: string) {
  const normalized = normalize(query);
  const exact = DOCUMENTS.find((document) => normalized.includes(normalize(document.number)));
  if (exact) return exact;

  const hint = extractSearchHint(query);
  const normalizedQuery = normalizeLegalQuery(query);
  const financeCircular =
    hint.type === "Thông tư" &&
    Boolean(hint.number && hint.year) &&
    /\b(?:bo tai chinh|btc|tt-btc)\b/.test(normalizedQuery);
  if (!financeCircular) return null;

  return DOCUMENTS.find((document) => {
    const [number, year, suffix] = document.number.split("/");
    return number === hint.number && year === hint.year && suffix === "TT-BTC";
  }) ?? null;
}
