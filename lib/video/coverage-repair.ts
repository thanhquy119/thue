import type {DocumentDetail, ProvisionDetail} from "@/lib/legal/types";
import {detectVideoCoverage, normalizeVideoEvidence} from "./chunking";
import type {LegalVideoCategory, LegalVideoEvidencePoint} from "./types";

const CATEGORY_PATTERNS: Partial<Record<LegalVideoCategory, RegExp[]>> = {
  scope: [/phạm vi áp dụng/iu, /đối tượng áp dụng/iu, /áp dụng đối với/iu],
  changes: [/sửa đổi/iu, /bổ sung/iu, /thay thế/iu, /bãi bỏ/iu],
  procedure: [/trình tự/iu, /thủ tục/iu, /hồ sơ/iu, /phương thức thực hiện/iu],
  obligation: [/có trách nhiệm/iu, /phải thực hiện/iu, /nghĩa vụ/iu, /người nộp thuế phải/iu],
  deadline: [/thời hạn/iu, /chậm nhất/iu, /ngày làm việc/iu, /trong thời gian/iu],
  numbers: [/\d+\s*%/iu, /\d[\d.,]*\s*(?:đồng|triệu|tỷ)/iu, /mức phạt/iu],
  effective: [/hiệu lực thi hành/iu, /có hiệu lực/iu],
  transition: [/điều khoản chuyển tiếp/iu, /chuyển tiếp/iu, /trước ngày/iu],
  forms: [/mẫu số/iu, /biểu mẫu/iu, /phụ lục/iu],
};

function splitSentences(value: string) {
  return value
    .replace(/[\t\r\u00a0]+/gu, " ")
    .replace(/\s+/gu, " ")
    .split(/(?<=[.!?;:])\s+(?=[A-ZÀ-Ỹ0-9])/gu)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 28);
}

function provisionText(provision: ProvisionDetail) {
  return [provision.identifier, provision.heading, provision.official_text]
    .filter(Boolean)
    .join(". ")
    .trim();
}

function candidates(document: DocumentDetail) {
  const fromProvisions = document.provisions
    .sort((left, right) => left.order_index - right.order_index)
    .flatMap((provision) =>
      splitSentences(provisionText(provision)).map((sentence) => ({
        sentence,
        provisionIds: [provision.id],
        sectionId: `coverage-${provision.id}`,
      })),
    );
  if (fromProvisions.length) return fromProvisions;
  return splitSentences(document.official_text).map((sentence, index) => ({
    sentence,
    provisionIds: [],
    sectionId: `coverage-text-${index + 1}`,
  }));
}

function findCategoryEvidence(document: DocumentDetail, category: LegalVideoCategory) {
  const patterns = CATEGORY_PATTERNS[category] ?? [];
  if (!patterns.length) return null;
  return candidates(document).find(({sentence}) => patterns.some((pattern) => pattern.test(sentence))) ?? null;
}

function pointKey(point: LegalVideoEvidencePoint) {
  return normalizeVideoEvidence(`${point.category}:${point.claim}`);
}

export function repairVideoEvidenceCoverage(
  document: DocumentDetail,
  points: LegalVideoEvidencePoint[],
) {
  const result = [...points];
  const keys = new Set(result.map(pointKey));
  const existingCategories = new Set(result.map((point) => point.category));
  const detected = detectVideoCoverage(document);

  for (const category of detected) {
    if (category === "overview" || existingCategories.has(category)) continue;
    const match = findCategoryEvidence(document, category);
    if (!match) continue;
    const claim = match.sentence.slice(0, 360).trim();
    const point: LegalVideoEvidencePoint = {
      id: `coverage-${category}-${result.length + 1}`,
      category,
      importance: 4,
      claim,
      sourceExcerpt: match.sentence,
      sectionId: match.sectionId,
      provisionIds: match.provisionIds,
    };
    const key = pointKey(point);
    if (keys.has(key)) continue;
    keys.add(key);
    result.push(point);
    existingCategories.add(category);
  }

  return result;
}
