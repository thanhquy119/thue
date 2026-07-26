import type { OfficialEvidence } from "./gemini.ts";
import { normalizeLegalQuery } from "./query.ts";
import type { DocumentDetail } from "./types.ts";

export type ReviewedFormGuidance = {
  documentNumber: string;
  formNumber: string;
  formTitle: string;
  formAliases: string[];
  fieldNumbers: number[];
  reviewedAt: string;
  officialPage: string;
  reviewedFormCopy: string;
  sourceLabel: string;
  summary: string;
  rules: Array<{
    title: string;
    text: string;
    fields: number[];
    references: string[];
  }>;
};

const GUIDANCE: ReviewedFormGuidance[] = [
  {
    documentNumber: "89/2026/TT-BTC",
    formNumber: "01/GTGT",
    formTitle: "Tờ khai thuế giá trị gia tăng áp dụng đối với người nộp thuế tính thuế theo phương pháp khấu trừ có hoạt động sản xuất kinh doanh",
    formAliases: [
      "01/gtgt",
      "to khai 01 gtgt",
      "to khai gtgt",
      "to khai khau tru",
      "phuong phap khau tru",
      "khai thue gtgt",
    ],
    fieldNumbers: [37, 38],
    reviewedAt: "2026-07-26",
    officialPage: "https://vanban.chinhphu.vn/?classid=1&docid=218974&orggroupid=4&pageid=27160",
    reviewedFormCopy: "https://cdn.thuvienphapluat.vn/uploads/mst/images/HuynhAnh/89-241-243.pdf",
    sourceLabel: "Mẫu số 01/GTGT và phần Ghi chú tại Phụ lục I ban hành kèm Thông tư 89/2026/TT-BTC, đã đối chiếu trực quan với bản biểu mẫu công bố",
    summary:
      "Chỉ tiêu [37] dùng để điều chỉnh giảm số thuế GTGT còn được khấu trừ của các kỳ trước; chỉ tiêu [38] dùng để điều chỉnh tăng số thuế GTGT còn được khấu trừ của các kỳ trước.",
    rules: [
      {
        title: "Mua hàng hóa, dịch vụ trả chậm hoặc trả góp từ 05 triệu đồng trở lên",
        text:
          "Đến kỳ tính thuế phát sinh nghĩa vụ thanh toán theo hợp đồng hoặc phụ lục hợp đồng, nếu phần giá trị đến hạn chưa có chứng từ thanh toán không dùng tiền mặt, kê khai số thuế GTGT đầu vào phải điều chỉnh giảm vào chỉ tiêu [37]; không phải khai bổ sung hồ sơ khai thuế. Sau đó, khi có chứng từ thanh toán không dùng tiền mặt, kê khai số thuế GTGT đầu vào được khấu trừ trở lại vào chỉ tiêu [38] của kỳ tính thuế có chứng từ thanh toán.",
        fields: [37, 38],
        references: ["Ghi chú 5 Mẫu số 01/GTGT, Phụ lục I Thông tư 89/2026/TT-BTC"],
      },
      {
        title: "Phát hiện thuế GTGT đầu vào đã kê khai, khấu trừ bị sai hoặc sót",
        text:
          "Kê khai vào chỉ tiêu [37] hoặc [38] của tháng hoặc quý phát hiện sai, sót nếu việc sửa tại kỳ phát sinh chỉ làm giảm số thuế phải nộp hoặc chỉ làm tăng hoặc giảm số thuế GTGT còn được khấu trừ chuyển kỳ sau; không phải khai bổ sung hồ sơ khai thuế cho kỳ gốc trong trường hợp này.",
        fields: [37, 38],
        references: ["Ghi chú 5 Mẫu số 01/GTGT, Phụ lục I Thông tư 89/2026/TT-BTC"],
      },
      {
        title: "Nhận hóa đơn điều chỉnh hoặc hóa đơn thay thế",
        text:
          "Nếu hóa đơn điều chỉnh hoặc hóa đơn thay thế thuộc các trường hợp quy định tại khoản 5 Điều 10 Thông tư 91/2026/TT-BTC, kê khai số điều chỉnh vào chỉ tiêu [37] hoặc [38] của kỳ tính thuế nhận được hóa đơn; không phải khai bổ sung hồ sơ khai thuế.",
        fields: [37, 38],
        references: [
          "Ghi chú 5 Mẫu số 01/GTGT, Phụ lục I Thông tư 89/2026/TT-BTC",
          "Khoản 5 Điều 10 Thông tư 91/2026/TT-BTC",
        ],
      },
      {
        title: "Chuyển từ phương pháp khấu trừ sang phương pháp trực tiếp trên doanh thu",
        text:
          "Kê khai điều chỉnh giảm toàn bộ số thuế GTGT chưa được khấu trừ hết vào chỉ tiêu [37] tại kỳ tính thuế cuối cùng trước khi chuyển đổi phương pháp tính thuế; không phải khai bổ sung hồ sơ khai thuế.",
        fields: [37],
        references: ["Ghi chú 5 Mẫu số 01/GTGT, Phụ lục I Thông tư 89/2026/TT-BTC"],
      },
      {
        title: "Các trường hợp khác",
        text:
          "Không mặc nhiên đưa mọi sai sót vào chỉ tiêu [37] hoặc [38]. Các trường hợp ngoài những tình huống nêu trên phải đối chiếu Điều 12 Nghị định 252/2026/NĐ-CP và Phụ lục II Thông tư 89/2026/TT-BTC để xác định có phải khai bổ sung hay điều chỉnh tại kỳ hiện tại.",
        fields: [37, 38],
        references: [
          "Điều 12 Nghị định 252/2026/NĐ-CP",
          "Phụ lục II Thông tư 89/2026/TT-BTC",
        ],
      },
    ],
  },
];

function normalizeIdentifier(value: string) {
  return normalizeLegalQuery(value).replace(/\s+/g, "");
}

function queryWithoutDocumentIdentifiers(query: string) {
  return normalizeLegalQuery(query)
    .replace(/\b(?:mau(?: so)?|to khai)?\s*0?\d{1,3}\s*\/?\s*gtgt\b/g, " ")
    .replace(/\b\d{1,4}\s*[/-]\s*20\d{2}(?:\s*[/-]\s*[a-z0-9-]+)?\b/g, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function requestedFormFieldNumbers(query: string) {
  const normalized = queryWithoutDocumentIdentifiers(query);
  const explicit = [...normalized.matchAll(/(?:chi tieu|ô|o)\s*\[?\s*(\d{1,3})\s*\]?/g)]
    .map((match) => Number(match[1]));
  const listContext = /\b(?:chi tieu|to khai|mau|bieu mau|ke khai|khau tru)\b/.test(normalized)
    ? (normalized.match(/\b\d{1,3}\b/g) ?? []).map(Number)
    : [];
  return Array.from(
    new Set([...explicit, ...listContext].filter((value) => Number.isInteger(value) && value > 0 && value < 1_000)),
  ).slice(0, 20);
}

function hasFormIntent(query: string) {
  const normalized = normalizeLegalQuery(query);
  return /\b(?:chi tieu|to khai|mau|bieu mau|ke khai|khau tru)\b/.test(normalized);
}

function documentMatches(guidance: ReviewedFormGuidance, documents: DocumentDetail[], query: string) {
  const expected = normalizeIdentifier(guidance.documentNumber);
  return (
    documents.some((document) => normalizeIdentifier(document.number) === expected) ||
    normalizeIdentifier(query).includes(expected)
  );
}

function formMatches(guidance: ReviewedFormGuidance, query: string) {
  const normalized = normalizeLegalQuery(query);
  return guidance.formAliases.some((alias) => normalized.includes(normalizeLegalQuery(alias)));
}

export function reviewedFormGuidanceForQuery(query: string, documents: DocumentDetail[]) {
  if (!hasFormIntent(query)) return null;
  const requestedFields = requestedFormFieldNumbers(query);
  if (!requestedFields.length) return null;

  const candidates = GUIDANCE.filter(
    (guidance) =>
      documentMatches(guidance, documents, query) &&
      requestedFields.some((field) => guidance.fieldNumbers.includes(field)),
  );
  if (!candidates.length) return null;

  return (
    candidates.find((guidance) => formMatches(guidance, query)) ??
    (candidates.length === 1 ? candidates[0] : null)
  );
}

export function reviewedFormGuidanceEvidence(
  guidance: ReviewedFormGuidance,
  requestedFields: number[],
): OfficialEvidence {
  const selectedRules = guidance.rules.filter((rule) =>
    rule.fields.some((field) => requestedFields.includes(field)),
  );
  return {
    document_number: guidance.documentNumber,
    title: `[Hướng dẫn biểu mẫu đã đối chiếu] Mẫu ${guidance.formNumber} — ${guidance.formTitle}`,
    issued_date: "2026-06-30",
    effective_date: "2026-07-01",
    status: "effective",
    excerpts: [
      `Nguồn và mức độ kiểm chứng: ${guidance.sourceLabel}. Trang công bố chính thức: ${guidance.officialPage}. Bản biểu mẫu dùng để đối chiếu trực quan: ${guidance.reviewedFormCopy}. Ngày rà soát: ${guidance.reviewedAt}.`,
      guidance.summary,
      ...selectedRules.map(
        (rule) => `${rule.title}\n${rule.text}\nCăn cứ: ${rule.references.join("; ")}.`,
      ),
    ],
  };
}

export function answerFromReviewedFormGuidance(
  guidance: ReviewedFormGuidance,
  requestedFields: number[],
) {
  const fields = requestedFields.filter((field) => guidance.fieldNumbers.includes(field));
  const selectedRules = guidance.rules.filter((rule) =>
    rule.fields.some((field) => fields.includes(field)),
  );
  const meanings: string[] = [];
  if (fields.includes(37)) {
    meanings.push("Chỉ tiêu [37]: ghi số thuế GTGT đầu vào cần điều chỉnh giảm khỏi số còn được khấu trừ của các kỳ trước.");
  }
  if (fields.includes(38)) {
    meanings.push("Chỉ tiêu [38]: ghi số thuế GTGT đầu vào cần điều chỉnh tăng trở lại vào số còn được khấu trừ của các kỳ trước.");
  }

  return [
    `Câu hỏi này là về Mẫu ${guidance.formNumber} — tờ khai thuế GTGT theo phương pháp khấu trừ, không phải tờ khai khấu trừ thuế TNCN. Theo phần Ghi chú của mẫu tại Phụ lục I Thông tư ${guidance.documentNumber}:`,
    meanings.join("\n"),
    ...selectedRules.map((rule, index) => `${index + 1}. ${rule.title}: ${rule.text}`),
    "Số điền vào [37] hoặc [38] là số thuế GTGT đầu vào cần điều chỉnh theo tình huống thực tế. Không mặc nhiên đưa mọi sai sót vào hai chỉ tiêu này; các trường hợp khác phải tiếp tục đối chiếu quy định về khai bổ sung.",
  ].join("\n\n");
}
