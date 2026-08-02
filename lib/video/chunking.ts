import type {DocumentDetail, ProvisionDetail} from "@/lib/legal/types";
import type {
  LegalVideoCategory,
  LegalVideoEvidenceSection,
  LegalVideoLength,
  LegalVideoScene,
} from "./types";

const NUMBER_TOKEN = /\b\d+(?:[.,/]\d+)*(?:\s*%|\s*(?:đồng|triệu|tỷ))?\b/giu;
const SPACE = /\s+/gu;

export const VIDEO_TEMPLATE_VERSION = "legal-video-v2";
export const VIDEO_PIPELINE_VERSION = "legal-video-pipeline-v2";

export function normalizeVideoEvidence(value: string) {
  return value
    .normalize("NFC")
    .replace(/[\u00a0\t\r]+/gu, " ")
    .replace(SPACE, " ")
    .trim()
    .toLocaleLowerCase("vi");
}

export function videoLengthProfile(length: LegalVideoLength) {
  if (length === "brief") {
    return {targetSeconds: 80, minScenes: 6, maxScenes: 9, maxEvidencePoints: 18};
  }
  if (length === "detailed") {
    return {targetSeconds: 300, minScenes: 14, maxScenes: 20, maxEvidencePoints: 48};
  }
  return {targetSeconds: 170, minScenes: 9, maxScenes: 14, maxEvidencePoints: 32};
}

function provisionLabel(provision: ProvisionDetail) {
  return [provision.identifier, provision.heading].filter(Boolean).join(" — ") || "Nội dung văn bản";
}

function evidenceSourceChars(document: DocumentDetail) {
  const provisions = document.provisions.filter((provision) => provision.official_text.trim());
  if (!provisions.length) return document.official_text.trim().length;
  return provisions.reduce(
    (total, provision) => total + provisionLabel(provision).length + provision.official_text.trim().length + 2,
    0,
  );
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Video ngắn không cần gọi mô hình cho từng Điều nhỏ. Kích thước phần được
 * điều chỉnh theo tổng dung lượng nguồn để giữ số lượt Gemini trong giới hạn
 * hợp lý, trong khi bản chi tiết vẫn dùng phần nhỏ hơn để giữ điều kiện/ngoại lệ.
 */
export function videoEvidenceSectionChars(document: DocumentDetail, length: LegalVideoLength) {
  const sourceChars = Math.max(1, evidenceSourceChars(document));
  if (length === "brief") return clamp(Math.ceil(sourceChars / 12), 12_000, 30_000);
  if (length === "detailed") return clamp(Math.ceil(sourceChars / 28), 8_500, 18_000);
  return clamp(Math.ceil(sourceChars / 18), 10_000, 24_000);
}

function appendProvision(
  sections: LegalVideoEvidenceSection[],
  current: LegalVideoEvidenceSection,
  provision: ProvisionDetail,
  maxChars: number,
) {
  const block = `${provisionLabel(provision)}\n${provision.official_text}`.trim();
  if (current.text && current.text.length + block.length + 2 > maxChars) {
    sections.push(current);
    return {
      id: `section-${sections.length + 1}`,
      heading: provisionLabel(provision),
      text: block,
      provisionIds: [provision.id],
      order: sections.length,
    } satisfies LegalVideoEvidenceSection;
  }
  return {
    ...current,
    heading: current.heading || provisionLabel(provision),
    text: [current.text, block].filter(Boolean).join("\n\n"),
    provisionIds: [...current.provisionIds, provision.id],
  };
}

export function buildVideoEvidenceSections(document: DocumentDetail, maxChars = 8_500) {
  const sections: LegalVideoEvidenceSection[] = [];
  let current: LegalVideoEvidenceSection = {
    id: "section-1",
    heading: document.title,
    text: "",
    provisionIds: [],
    order: 0,
  };

  const provisions = document.provisions
    .filter((provision) => provision.official_text.trim())
    .sort((left, right) => left.order_index - right.order_index);

  if (!provisions.length) {
    const source = document.official_text.trim();
    for (let cursor = 0; cursor < source.length; cursor += maxChars) {
      const text = source.slice(cursor, cursor + maxChars).trim();
      if (!text) continue;
      sections.push({
        id: `section-${sections.length + 1}`,
        heading: sections.length ? `Phần ${sections.length + 1}` : document.title,
        text,
        provisionIds: [],
        order: sections.length,
      });
    }
    return sections;
  }

  for (const provision of provisions) {
    current = appendProvision(sections, current, provision, maxChars);
  }
  if (current.text.trim()) sections.push(current);
  return sections.map((section, index) => ({...section, id: `section-${index + 1}`, order: index}));
}

function sentenceSegments(value: string) {
  const text = value.replace(SPACE, " ").trim();
  if (!text) return [];
  try {
    const Segmenter = Intl.Segmenter;
    if (Segmenter) {
      return [...new Segmenter("vi", {granularity: "sentence"}).segment(text)]
        .map((item) => item.segment.trim())
        .filter(Boolean);
    }
  } catch {
    // Dùng biểu thức dự phòng trên runtime chưa hỗ trợ Segmenter.
  }
  return text.split(/(?<=[.!?;:])\s+(?=[A-ZÀ-Ỹ0-9])/gu).map((item) => item.trim()).filter(Boolean);
}

function splitLongSentence(sentence: string, maxChars: number) {
  if (sentence.length <= maxChars) return [sentence];
  const pieces = sentence
    .split(/(?<=[,;:])\s+/gu)
    .map((item) => item.trim())
    .filter(Boolean);
  const result: string[] = [];
  let current = "";
  for (const piece of pieces.length > 1 ? pieces : [sentence]) {
    if (piece.length > maxChars) {
      if (current) {
        result.push(current);
        current = "";
      }
      for (let cursor = 0; cursor < piece.length; cursor += maxChars) {
        result.push(piece.slice(cursor, cursor + maxChars).trim());
      }
      continue;
    }
    const candidate = [current, piece].filter(Boolean).join(" ");
    if (candidate.length > maxChars && current) {
      result.push(current);
      current = piece;
    } else {
      current = candidate;
    }
  }
  if (current) result.push(current);
  return result;
}

export function splitVietnameseTtsText(value: string, targetChars = 480, maxChars = 720) {
  const sentences = sentenceSegments(value).flatMap((sentence) => splitLongSentence(sentence, maxChars));
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = [current, sentence].filter(Boolean).join(" ");
    const shouldFlush = current && candidate.length > targetChars;
    if (shouldFlush) {
      chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
    if (current.length >= maxChars) {
      chunks.push(current);
      current = "";
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

export function extractVideoNumberTokens(value: string) {
  return [...normalizeVideoEvidence(value).matchAll(NUMBER_TOKEN)]
    .map((match) => match[0].replace(SPACE, " ").trim())
    .filter(Boolean);
}

export function sourceContainsEvidence(source: string, excerpt: string) {
  const expected = normalizeVideoEvidence(excerpt);
  return expected.length >= 12 && normalizeVideoEvidence(source).includes(expected);
}

export function sceneNumbersAreGrounded(scene: LegalVideoScene, source: string) {
  const allowed = normalizeVideoEvidence(source);
  const displayed = [scene.title, scene.subtitle ?? "", ...scene.bullets, scene.narration].join(" ");
  return extractVideoNumberTokens(displayed).every((token) => allowed.includes(normalizeVideoEvidence(token)));
}

export function validateGroundedScene(scene: LegalVideoScene, source: string) {
  const issues: string[] = [];
  if (scene.kind !== "intro" && !sourceContainsEvidence(source, scene.sourceExcerpt)) {
    issues.push("source_excerpt_not_found");
  }
  if (!sceneNumbersAreGrounded(scene, source)) issues.push("ungrounded_number");
  if (!scene.title.trim() || !scene.narration.trim()) issues.push("missing_content");
  if (scene.bullets.length > 3) issues.push("too_many_bullets");
  return issues;
}

function includesAny(source: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(source));
}

export function detectVideoCoverage(document: DocumentDetail): LegalVideoCategory[] {
  const source = normalizeVideoEvidence(document.official_text);
  const categories = new Set<LegalVideoCategory>(["overview"]);
  if (includesAny(source, [/phạm vi áp dụng/u, /đối tượng áp dụng/u, /áp dụng đối với/u])) categories.add("scope");
  if (includesAny(source, [/sửa đổi/u, /bổ sung/u, /thay thế/u, /điểm mới/u])) categories.add("changes");
  if (includesAny(source, [/trình tự/u, /thủ tục/u, /hồ sơ/u, /thực hiện theo/u])) categories.add("procedure");
  if (includesAny(source, [/có trách nhiệm/u, /phải thực hiện/u, /nghĩa vụ/u, /người nộp thuế phải/u])) categories.add("obligation");
  if (includesAny(source, [/thời hạn/u, /trong thời gian/u, /chậm nhất/u, /ngày làm việc/u])) categories.add("deadline");
  if (includesAny(source, [/\d+\s*%/u, /\d[\d.,]*\s*(?:đồng|triệu|tỷ)/u, /mức phạt/u])) categories.add("numbers");
  if (document.effective_date || includesAny(source, [/hiệu lực thi hành/u, /có hiệu lực/u])) categories.add("effective");
  if (includesAny(source, [/điều khoản chuyển tiếp/u, /chuyển tiếp/u, /trước ngày/u])) categories.add("transition");
  if (includesAny(source, [/mẫu số/u, /biểu mẫu/u, /phụ lục/u])) categories.add("forms");
  return [...categories];
}
