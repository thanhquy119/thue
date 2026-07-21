export type TaxQuestionPlan = {
  normalized: string;
  isQuestion: boolean;
  hasDocumentReference: boolean;
  taxAreas: string[];
  subjects: string[];
  intents: string[];
  explicitYears: string[];
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9%/_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TAX_AREAS: Array<{ label: string; pattern: RegExp }> = [
  { label: "thuế giá trị gia tăng", pattern: /\b(?:gtgt|vat|gia tri gia tang)\b/ },
  { label: "thuế thu nhập cá nhân", pattern: /\b(?:tncn|thu nhap ca nhan)\b/ },
  { label: "thuế thu nhập doanh nghiệp", pattern: /\b(?:tndn|thu nhap doanh nghiep)\b/ },
  { label: "hóa đơn điện tử", pattern: /\b(?:hoa don|may tinh tien)\b/ },
  { label: "quản lý thuế", pattern: /\b(?:quan ly thue|khai thue|nop thue|dang ky thue|ma so thue)\b/ },
  { label: "lệ phí môn bài", pattern: /\b(?:le phi mon bai|thue mon bai|mon bai)\b/ },
  { label: "thuế nhà thầu", pattern: /\b(?:thue nha thau|nha thau nuoc ngoai|fct)\b/ },
  { label: "thuế tiêu thụ đặc biệt", pattern: /\b(?:tieu thu dac biet|ttdb)\b/ },
  { label: "thuế xuất nhập khẩu", pattern: /\b(?:xuat khau|nhap khau|hai quan)\b/ },
  { label: "thuế tài nguyên và môi trường", pattern: /\b(?:thue tai nguyen|bao ve moi truong)\b/ },
  { label: "thuế, tiền sử dụng đất", pattern: /\b(?:su dung dat|tien thue dat|thue dat|dat phi nong nghiep)\b/ },
];

const SUBJECTS: Array<{ label: string; pattern: RegExp }> = [
  { label: "hộ kinh doanh, cá nhân kinh doanh", pattern: /\b(?:ho kinh doanh|ca nhan kinh doanh)\b/ },
  { label: "doanh nghiệp, tổ chức", pattern: /\b(?:doanh nghiep|cong ty|to chuc|hop tac xa)\b/ },
  { label: "tổ chức trả thu nhập", pattern: /\b(?:to chuc tra thu nhap|don vi tra thu nhap|nguoi su dung lao dong)\b/ },
  { label: "cá nhân, người lao động", pattern: /\b(?:ca nhan|nguoi lao dong|tien luong|tien cong)\b/ },
  { label: "nhà thầu nước ngoài", pattern: /\b(?:nha thau nuoc ngoai|nha cung cap nuoc ngoai)\b/ },
  { label: "hoạt động thương mại điện tử", pattern: /\b(?:thuong mai dien tu|san thuong mai dien tu|ban hang online|livestream|content creator|youtuber|tiktoker)\b/ },
  { label: "đơn vị phụ thuộc, địa điểm kinh doanh", pattern: /\b(?:don vi phu thuoc|chi nhanh|dia diem kinh doanh)\b/ },
];

const INTENTS: Array<{ label: string; pattern: RegExp }> = [
  { label: "thuế suất, mức thuế và cách tính", pattern: /\b(?:thue suat|muc thue|bao nhieu phan tram|cach tinh|tinh thue|so thue phai nop)\b/ },
  { label: "ngưỡng doanh thu, miễn thuế, không chịu thuế", pattern: /\b(?:nguong|doanh thu|mien thue|giam thue|khong chiu thue|khong phai nop)\b/ },
  { label: "khai thuế, hồ sơ và mẫu biểu", pattern: /\b(?:khai thue|to khai|ho so|mau bieu|mau nao|phu luc)\b/ },
  { label: "thời hạn khai, nộp và xử lý", pattern: /\b(?:thoi han|han nop|bao gio|cham nhat|bao nhieu ngay)\b/ },
  { label: "hóa đơn và chứng từ", pattern: /\b(?:hoa don|chung tu|may tinh tien)\b/ },
  { label: "khấu trừ thuế, chi phí được trừ", pattern: /\b(?:khau tru|chi phi duoc tru|dau vao|giam tru)\b/ },
  { label: "hoàn thuế", pattern: /\b(?:hoan thue|hoan gtgt)\b/ },
  { label: "quyết toán thuế", pattern: /\b(?:quyet toan|uy quyen quyet toan)\b/ },
  { label: "đăng ký thuế và mã số thuế", pattern: /\b(?:dang ky thue|ma so thue|cham dut hieu luc ma so thue)\b/ },
  { label: "xử phạt, tiền chậm nộp và cưỡng chế", pattern: /\b(?:xu phat|phat bao nhieu|tien cham nop|cham nop|cuong che|vi pham)\b/ },
  { label: "phân bổ nghĩa vụ thuế, khai tập trung", pattern: /\b(?:phan bo|khai tap trung|tinh khac|dia phuong khac)\b/ },
  { label: "sửa đổi, bổ sung, thay thế và đối chiếu", pattern: /\b(?:sua doi|bo sung|thay the|bai bo|diem moi|doi chieu|phan tich)\b/ },
];

const QUESTION_PATTERN =
  /\?|\b(?:bao nhieu|the nao|duoc khong|co phai|phai khong|tai sao|can lam gi|bao gio|han nop|thoi han|mau nao|cach tinh|ap dung|xu ly|phan tich|giai thich|doi chieu|huong dan|khai thue|nop thue|hoan thue|khau tru|quyet toan|hoa don|doanh thu|thue suat|chi phi duoc tru|mien thue|giam thue|khong chiu thue|dang ky thue|ma so thue|xu phat|cham nop|phan bo|khai tap trung)\b/;

const DOCUMENT_REFERENCE_PATTERN =
  /\b(?:nghi dinh|thong tu|nghi quyet|quyet dinh|luat|nd|tt|nq|qd)\s*(?:so\s*)?\d{1,4}\s*[/-]\s*20\d{2}(?:\s*[/-]\s*[a-z0-9-]+)?\b/;

export function analyzeTaxQuestion(query: string): TaxQuestionPlan {
  const normalized = normalize(query);
  const explicitYears = Array.from(new Set(normalized.match(/\b20\d{2}\b/g) ?? []));
  return {
    normalized,
    isQuestion: QUESTION_PATTERN.test(normalized),
    hasDocumentReference: DOCUMENT_REFERENCE_PATTERN.test(normalized),
    taxAreas: TAX_AREAS.filter((item) => item.pattern.test(normalized)).map((item) => item.label).slice(0, 3),
    subjects: SUBJECTS.filter((item) => item.pattern.test(normalized)).map((item) => item.label).slice(0, 3),
    intents: INTENTS.filter((item) => item.pattern.test(normalized)).map((item) => item.label).slice(0, 4),
    explicitYears,
  };
}

export function clarificationForTaxQuestion(query: string, plan = analyzeTaxQuestion(query)) {
  if (!plan.isQuestion || plan.hasDocumentReference) return null;
  const words = plan.normalized.split(" ").filter(Boolean);
  const asksRate = plan.intents.includes("thuế suất, mức thuế và cách tính");
  const asksDeadline = plan.intents.includes("thời hạn khai, nộp và xử lý");
  const asksFiling = plan.intents.includes("khai thuế, hồ sơ và mẫu biểu");

  if (asksRate && !plan.taxAreas.length && !plan.subjects.length) {
    return "Để xác định đúng mức thuế, vui lòng cho biết loại thuế, đối tượng nộp thuế, hoạt động phát sinh và kỳ tính thuế cần áp dụng.";
  }
  if (asksDeadline && !plan.taxAreas.length && !asksFiling) {
    return "Để xác định đúng thời hạn, vui lòng cho biết đây là hạn nộp tờ khai, hạn nộp tiền thuế hay hạn quyết toán; đồng thời nêu loại thuế và kỳ tính thuế.";
  }
  if (words.length <= 5 && !plan.taxAreas.length && !plan.subjects.length && !plan.intents.length) {
    return "Câu hỏi hiện còn quá chung. Vui lòng bổ sung đối tượng nộp thuế, loại thuế hoặc nghiệp vụ cần xử lý và thời kỳ phát sinh.";
  }
  return null;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function enrichTaxQuestion(query: string, plan = analyzeTaxQuestion(query), now = new Date()) {
  if (!plan.isQuestion || plan.hasDocumentReference) return query.trim();
  const context = [
    plan.taxAreas.length ? `lĩnh vực: ${plan.taxAreas.join(", ")}` : "",
    plan.subjects.length ? `đối tượng: ${plan.subjects.join(", ")}` : "",
    plan.intents.length ? `nghiệp vụ: ${plan.intents.join(", ")}` : "",
    plan.explicitYears.length
      ? `thời kỳ người dùng nêu: ${plan.explicitYears.join(", ")}`
      : `áp dụng tại ngày ${formatDate(now)}`,
  ]
    .filter(Boolean)
    .join("; ");
  const suffix = ` Ngữ cảnh tra cứu pháp lý: ${context}. Ưu tiên quy định còn hiệu lực đúng thời kỳ; đối chiếu văn bản sửa đổi, bổ sung, thay thế và không dùng văn bản hết hiệu lực toàn bộ.`;
  return `${query.trim()}${suffix}`.slice(0, 490).trim();
}

function parseLocalizedNumber(value: string) {
  const compact = value.replace(/\s+/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const number = Number(compact);
  return Number.isFinite(number) ? number : null;
}

function numericClaims(value: string) {
  const normalized = normalize(value);
  const claims = new Set<string>();
  for (const match of normalized.matchAll(/(\d[\d.,]*)\s*(ty|trieu|nghin)?\s*(?:dong|vnd)\b/g)) {
    const amount = parseLocalizedNumber(match[1]);
    if (amount === null) continue;
    const multiplier = match[2] === "ty" ? 1_000_000_000 : match[2] === "trieu" ? 1_000_000 : match[2] === "nghin" ? 1_000 : 1;
    claims.add(`money:${Math.round(amount * multiplier)}`);
  }
  for (const match of normalized.matchAll(/(\d[\d.,]*)\s*%/g)) {
    const rate = parseLocalizedNumber(match[1]);
    if (rate !== null) claims.add(`percent:${rate}`);
  }
  return claims;
}

function compactIdentifier(value: string) {
  return normalize(value).replace(/\s+/g, "");
}

export function answerGroundingIssues(answer: string, evidenceText: string, documentNumbers: string[]) {
  const issues: string[] = [];
  const answerId = compactIdentifier(answer);
  const mentionsDocument = documentNumbers.some((number) => {
    const identifier = compactIdentifier(number);
    return identifier.length >= 3 && answerId.includes(identifier);
  });
  if (documentNumbers.length && !mentionsDocument) issues.push("missing_document_reference");

  const answerClaims = numericClaims(answer);
  const evidenceClaims = numericClaims(evidenceText);
  const unsupported = [...answerClaims].filter((claim) => !evidenceClaims.has(claim));
  if (unsupported.length) issues.push("unsupported_numeric_claim");
  return issues;
}
