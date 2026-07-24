import { extractSearchHint, normalizeLegalQuery } from "./query.ts";

export type RecentDocumentDownload = {
  url: string;
  fileName: string;
  mimeType: string;
  referer: string;
  label: string;
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
