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

const QUERY_AREA_PATTERNS: Record<string, RegExp> = {
  "thuế giá trị gia tăng": /\b(?:gtgt|vat|gia tri gia tang)\b/,
  "thuế thu nhập cá nhân": /\b(?:tncn|thu nhap ca nhan)\b/,
  "thuế thu nhập doanh nghiệp": /\b(?:tndn|thu nhap doanh nghiep)\b/,
  "hóa đơn điện tử": /\b(?:hoa don|may tinh tien)\b/,
  "quản lý thuế": /\b(?:quan ly thue|khai thue|nop thue|dang ky thue|ma so thue)\b/,
  "lệ phí môn bài": /\b(?:le phi mon bai|thue mon bai|mon bai)\b/,
  "thuế nhà thầu": /\b(?:thue nha thau|nha thau nuoc ngoai|fct)\b/,
  "thuế tiêu thụ đặc biệt": /\b(?:tieu thu dac biet|ttdb)\b/,
  "thuế xuất nhập khẩu": /\b(?:xuat khau|nhap khau|hai quan)\b/,
  "thuế tài nguyên và môi trường": /\b(?:thue tai nguyen|bao ve moi truong)\b/,
  "thuế, tiền sử dụng đất": /\b(?:su dung dat|tien thue dat|thue dat|dat phi nong nghiep)\b/,
};

const SOURCE_AREA_PATTERNS: Record<string, RegExp> = {
  "thuế giá trị gia tăng": /\b(?:gtgt|gia tri gia tang|thue vat)\b/,
  "thuế thu nhập cá nhân": /\b(?:tncn|thu nhap ca nhan)\b/,
  "thuế thu nhập doanh nghiệp": /\b(?:tndn|thu nhap doanh nghiep)\b/,
  "hóa đơn điện tử": /\b(?:hoa don|may tinh tien)\b/,
  "quản lý thuế": /\b(?:quan ly thue|khai thue|nop thue|dang ky thue|ma so thue)\b/,
  "lệ phí môn bài": /\b(?:le phi mon bai|thue mon bai|mon bai)\b/,
  "thuế nhà thầu": /\b(?:thue nha thau|nha thau nuoc ngoai|fct)\b/,
  "thuế tiêu thụ đặc biệt": /\b(?:tieu thu dac biet|ttdb)\b/,
  "thuế xuất nhập khẩu": /\b(?:xuat khau|nhap khau|hai quan)\b/,
  "thuế tài nguyên và môi trường": /\b(?:thue tai nguyen|thue bao ve moi truong)\b/,
  "thuế, tiền sử dụng đất": /\b(?:su dung dat|tien thue dat|thue dat|dat phi nong nghiep)\b/,
};

const QUERY_SUBJECT_PATTERNS: Record<string, RegExp> = {
  "hộ kinh doanh, cá nhân kinh doanh": /\b(?:ho kinh doanh|ca nhan kinh doanh)\b/,
  "doanh nghiệp, tổ chức": /\b(?:doanh nghiep|cong ty|to chuc|hop tac xa)\b/,
  "tổ chức trả thu nhập": /\b(?:to chuc tra thu nhap|don vi tra thu nhap|nguoi su dung lao dong)\b/,
  "cá nhân, người lao động": /\b(?:ca nhan|nguoi lao dong|tien luong|tien cong)\b/,
  "nhà thầu nước ngoài": /\b(?:nha thau nuoc ngoai|nha cung cap nuoc ngoai)\b/,
  "hoạt động thương mại điện tử": /\b(?:thuong mai dien tu|san thuong mai dien tu|ban hang online|livestream|content creator|youtuber|tiktoker)\b/,
  "đơn vị phụ thuộc, địa điểm kinh doanh": /\b(?:don vi phu thuoc|chi nhanh|dia diem kinh doanh)\b/,
};

const SOURCE_SUBJECT_PATTERNS = QUERY_SUBJECT_PATTERNS;

const QUERY_INTENT_PATTERNS: Record<string, RegExp> = {
  "thuế suất, mức thuế và cách tính": /\b(?:thue suat|muc thue|bao nhieu phan tram|cach tinh|tinh thue|so thue phai nop)\b/,
  "ngưỡng doanh thu, miễn thuế, không chịu thuế": /\b(?:nguong|doanh thu|mien thue|giam thue|khong chiu thue|khong phai nop)\b/,
  "khai thuế, hồ sơ và mẫu biểu": /\b(?:khai thue|to khai|ho so|mau bieu|mau nao|phu luc)\b/,
  "thời hạn khai, nộp và xử lý": /\b(?:thoi han|han nop|bao gio|cham nhat|bao nhieu ngay)\b/,
  "hóa đơn và chứng từ": /\b(?:hoa don|chung tu|may tinh tien)\b/,
  "khấu trừ thuế, chi phí được trừ": /\b(?:khau tru|chi phi duoc tru|dau vao|giam tru)\b/,
  "hoàn thuế": /\b(?:hoan thue|hoan gtgt)\b/,
  "quyết toán thuế": /\b(?:quyet toan|uy quyen quyet toan)\b/,
  "đăng ký thuế và mã số thuế": /\b(?:dang ky thue|ma so thue|cham dut hieu luc ma so thue)\b/,
  "xử phạt, tiền chậm nộp và cưỡng chế": /\b(?:xu phat|phat bao nhieu|tien cham nop|cham nop|cuong che|vi pham)\b/,
  "phân bổ nghĩa vụ thuế, khai tập trung": /\b(?:phan bo|khai tap trung|tinh khac|dia phuong khac)\b/,
  "sửa đổi, bổ sung, thay thế và đối chiếu": /\b(?:sua doi|bo sung|thay the|bai bo|diem moi|doi chieu|phan tich)\b/,
};

const SOURCE_INTENT_PATTERNS: Record<string, RegExp> = {
  "thuế suất, mức thuế và cách tính": /\b(?:thue suat|muc thue|can cu tinh thue|cach tinh|so thue phai nop)\b/,
  "ngưỡng doanh thu, miễn thuế, không chịu thuế": /\b(?:nguong doanh thu|mien thue|giam thue|khong chiu thue|khong phai nop)\b/,
  "khai thuế, hồ sơ và mẫu biểu": /\b(?:khai thue|to khai|ho so|mau bieu|phu luc)\b/,
  "thời hạn khai, nộp và xử lý": /\b(?:thoi han|han nop|cham nhat|thoi gian giai quyet)\b/,
  "hóa đơn và chứng từ": /\b(?:hoa don|chung tu|may tinh tien)\b/,
  "khấu trừ thuế, chi phí được trừ": /\b(?:khau tru|chi phi duoc tru|thue dau vao|giam tru)\b/,
  "hoàn thuế": /\b(?:hoan thue|hoan gtgt)\b/,
  "quyết toán thuế": /\b(?:quyet toan|uy quyen quyet toan)\b/,
  "đăng ký thuế và mã số thuế": /\b(?:dang ky thue|ma so thue|cham dut hieu luc ma so thue)\b/,
  "xử phạt, tiền chậm nộp và cưỡng chế": /\b(?:xu phat|tien cham nop|cham nop|cuong che|vi pham)\b/,
  "phân bổ nghĩa vụ thuế, khai tập trung": /\b(?:phan bo|khai tap trung|dia phuong khac)\b/,
  "sửa đổi, bổ sung, thay thế và đối chiếu": /\b(?:sua doi|bo sung|thay the|bai bo|diem moi)\b/,
};

const PRIMARY_INTENT_ORDER = [
  "hoàn thuế",
  "quyết toán thuế",
  "xử phạt, tiền chậm nộp và cưỡng chế",
  "hóa đơn và chứng từ",
  "khấu trừ thuế, chi phí được trừ",
  "đăng ký thuế và mã số thuế",
  "ngưỡng doanh thu, miễn thuế, không chịu thuế",
  "thuế suất, mức thuế và cách tính",
  "phân bổ nghĩa vụ thuế, khai tập trung",
  "sửa đổi, bổ sung, thay thế và đối chiếu",
  "khai thuế, hồ sơ và mẫu biểu",
  "thời hạn khai, nộp và xử lý",
];

const QUESTION_PATTERN =
  /\?|\b(?:bao nhieu|the nao|duoc khong|co phai|phai khong|tai sao|can lam gi|bao gio|han nop|thoi han|mau nao|cach tinh|ap dung|xu ly|phan tich|giai thich|doi chieu|huong dan|khai thue|nop thue|hoan thue|khau tru|quyet toan|hoa don|doanh thu|thue suat|chi phi duoc tru|mien thue|giam thue|khong chiu thue|dang ky thue|ma so thue|xu phat|cham nop|phan bo|khai tap trung)\b/;
const DOCUMENT_REFERENCE_PATTERN =
  /\b(?:nghi dinh|thong tu|nghi quyet|quyet dinh|luat|nd|tt|nq|qd)\s*(?:so\s*)?\d{1,4}\s*[/-]\s*20\d{2}(?:\s*[/-]\s*[a-z0-9-]+)?\b/;

const RETRIEVAL_STOP_WORDS = new Set([
  "thue", "van", "ban", "quy", "dinh", "hien", "hanh", "nguoi", "dung", "can", "phai", "duoc", "khong", "thi", "va", "cua", "cho", "nam",
]);

function matchingLabels(patterns: Record<string, RegExp>, value: string) {
  return Object.entries(patterns)
    .filter(([, pattern]) => pattern.test(value))
    .map(([label]) => label);
}

function countMatches(labels: string[], patterns: Record<string, RegExp>, candidate: string) {
  return labels.filter((label) => patterns[label]?.test(candidate)).length;
}

export function taxSourceRelevance(query: string, candidate: string) {
  const normalizedQuery = normalize(query);
  const isQuestion = QUESTION_PATTERN.test(normalizedQuery);
  const hasDocumentReference = DOCUMENT_REFERENCE_PATTERN.test(normalizedQuery);
  if (!isQuestion || hasDocumentReference) return 1;

  const taxAreas = matchingLabels(QUERY_AREA_PATTERNS, normalizedQuery);
  const subjects = matchingLabels(QUERY_SUBJECT_PATTERNS, normalizedQuery);
  const intents = matchingLabels(QUERY_INTENT_PATTERNS, normalizedQuery);
  const primaryIntent = PRIMARY_INTENT_ORDER.find((intent) => intents.includes(intent)) ?? null;
  const normalizedCandidate = normalize(candidate);
  const areaMatches = countMatches(taxAreas, SOURCE_AREA_PATTERNS, normalizedCandidate);
  const subjectMatches = countMatches(subjects, SOURCE_SUBJECT_PATTERNS, normalizedCandidate);
  const intentMatches = countMatches(intents, SOURCE_INTENT_PATTERNS, normalizedCandidate);
  const administrationBridge =
    /\b(?:luat quan ly thue|quan ly thue|thu tuc thue|khai thue|hoan thue)\b/.test(normalizedCandidate);
  const hasTaxMarker =
    /\b(?:thue|gtgt|tncn|tndn|gia tri gia tang|hoa don|hai quan|le phi|quan ly thue)\b/.test(normalizedCandidate);

  if (!hasTaxMarker && areaMatches === 0 && !administrationBridge) return -5;

  const asksEnterprise = subjects.includes("doanh nghiệp, tổ chức");
  const sourceOnlyHousehold =
    /\b(?:ho kinh doanh|ca nhan kinh doanh)\b/.test(normalizedCandidate) &&
    !/\b(?:doanh nghiep|cong ty|to chuc|nguoi nop thue)\b/.test(normalizedCandidate);
  if (asksEnterprise && sourceOnlyHousehold) return -4.5;

  if (primaryIntent && !SOURCE_INTENT_PATTERNS[primaryIntent]?.test(normalizedCandidate)) return -3.5;
  if (taxAreas.length && areaMatches === 0 && intentMatches === 0 && !administrationBridge) return -4;

  const queryTokens = new Set(
    normalizedQuery
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2 && !RETRIEVAL_STOP_WORDS.has(token) && !/^20\d{2}$/.test(token)),
  );
  const candidateTokens = new Set(normalizedCandidate.split(/[^a-z0-9]+/).filter(Boolean));
  const tokenMatches = [...queryTokens].filter((token) => candidateTokens.has(token)).length;

  return (
    areaMatches * 3 +
    intentMatches * 1.6 +
    subjectMatches * 0.7 +
    (administrationBridge ? 1.4 : 0) +
    Math.min(2, tokenMatches * 0.22)
  );
}
