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
    downloads: [
      {
        url: "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/7/94-btc.pdf",
        fileName: "94-btc.pdf",
        mimeType: "application/pdf",
        referer: "https://vanban.chinhphu.vn/?classid=1&docid=218894&orggroupid=4&pageid=27160",
        label: "Tệp PDF chính thức của Cổng Chính phủ",
      },
      {
        url: "https://baocaotaichinh.vn/tintuc/download?file=897412141thong-tu-so-94_2026_tt-btc.pdf",
        fileName: "Thong tu so 94_2026_TT-BTC.pdf",
        mimeType: "application/pdf",
        referer:
          "https://baocaotaichinh.vn/thu-vien/thong-tu-so-94-2026-ttbtc-cua-bo-tai-chinh-quy-dinh-ve-quan-ly-tuan-thu-quan-ly-rui-ro-trong-quan-ly-thue-1178433928-272481",
        label: "Bản PDF công bố lại đã đối chiếu với Cổng Chính phủ",
      },
    ],
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
  return DOCUMENTS.find((document) => normalized.includes(normalize(document.number))) ?? null;
}
