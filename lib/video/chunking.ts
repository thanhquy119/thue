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
    text: [current.text, block].filter(Boolean).join("\n\n"),
    provisionIds: [...current.provisionIds, provision.id],
  };
}

function splitLongText(value: string, maxChars: number) {
  const paragraphs = value.split(/\n{2,}/gu).map((item) => item.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > maxChars) {
      chunks.push(current);
      current = "";
    }
    if (paragraph.length <= maxChars) {
      current = [current, paragraph].filter(Boolean).join("\n\n");
      continue;
    }
    const sentences = paragraph.split(/(?<=[.!?;:])\s+/gu);
    for (const sentence of sentences) {
      if (current && current.length + sentence.length + 1 > maxChars) {
        chunks.push(current);
        current = "";
      }
      if (sentence.length <= maxChars) {
        current = [current, sentence].filter(Boolean).join(" ");
        continue;
      }
      for (let offset = 0; offset < sentence.length; offset += maxChars) {
        const part = sentence.slice(offset, offset + maxChars).trim();
        if (part) chunks.push(part);
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function buildVideoEvidenceSections(document: DocumentDetail, maxChars: number) {
  const provisions = document.provisions.filter((provision) => provision.official_text.trim());
  if (!provisions.length) {
    return splitLongText(document.official_text, maxChars).map((text, index): LegalVideoEvidenceSection => ({
      id: `section-${index + 1}`,
      heading: index === 0 ? document.title : `Phần ${index + 1}`,
      text,
      provisionIds: [],
      order: index,
    }));
  }
  const sections: LegalVideoEvidenceSection[] = [];
  let current: LegalVideoEvidenceSection = {
    id: "section-1",
    heading: provisionLabel(provisions[0]),
    text: "",
    provisionIds: [],
    order: 0,
  };
  for (const provision of provisions) {
    if (provision.official_text.length > maxChars) {
      if (current.text) sections.push(current);
      const chunks = splitLongText(`${provisionLabel(provision)}\n${provision.official_text}`, maxChars);
      for (const text of chunks) {
        sections.push({
          id: `section-${sections.length + 1}`,
          heading: provisionLabel(provision),
          text,
          provisionIds: [provision.id],
          order: sections.length,
        });
      }
      current = {
        id: `section-${sections.length + 1}`,
        heading: provisionLabel(provision),
        text: "",
        provisionIds: [],
        order: sections.length,
      };
      continue;
    }
    current = appendProvision(sections, current, provision, maxChars);
    current.id = `section-${sections.length + 1}`;
    current.order = sections.length;
  }
  if (current.text) sections.push(current);
  return sections;
}

export function normalizeEvidenceForMatch(value: string) {
  return normalizeVideoEvidence(value)
    .replace(/[“”"'‘’()[\]{}]/gu, "")
    .replace(/[^\p{L}\p{N}%.,/\s-]+/gu, " ")
    .replace(SPACE, " ")
    .trim();
}

export function sourceContainsEvidence(source: string, excerpt: string) {
  const normalizedSource = normalizeEvidenceForMatch(source);
  const normalizedExcerpt = normalizeEvidenceForMatch(excerpt);
  if (normalizedExcerpt.length < 18) return false;
  return normalizedSource.includes(normalizedExcerpt);
}

export function extractVideoNumberTokens(value: string) {
  return value.match(NUMBER_TOKEN)?.map((token) => token.replace(SPACE, " ").trim()) ?? [];
}

export function sceneNumbersAreGrounded(scene: LegalVideoScene, source: string) {
  const sourceNormalized = normalizeVideoEvidence(source);
  const allowed = normalizeVideoEvidence([scene.sourceExcerpt, ...scene.bullets].filter(Boolean).join(" "));
  return extractVideoNumberTokens([scene.title, scene.subtitle, scene.narration, ...scene.bullets].filter(Boolean).join(" "))
    .every((token) => {
      const normalized = normalizeVideoEvidence(token);
      return allowed.includes(normalized) && sourceNormalized.includes(normalized);
    });
}

export function validateGroundedScene(scene: LegalVideoScene, source: string) {
  const errors: string[] = [];
  if (!scene.title.trim()) errors.push("missing_title");
  if (!scene.narration.trim()) errors.push("missing_narration");
  if (!scene.captionChunks.length) errors.push("missing_captions");
  if (scene.sourceExcerpt && !sourceContainsEvidence(source, scene.sourceExcerpt)) errors.push("invalid_source_excerpt");
  if (!sceneNumbersAreGrounded(scene, source)) errors.push("ungrounded_number");
  return errors;
}

const COVERAGE_PATTERNS: Array<[LegalVideoCategory, RegExp]> = [
  ["scope", /phạm vi|đối tượng|áp dụng đối với/iu],
  ["changes", /sửa đổi|bổ sung|thay thế|bãi bỏ/iu],
  ["procedure", /hồ sơ|thủ tục|trình tự/iu],
  ["obligation", /nghĩa vụ|trách nhiệm|phải thực hiện/iu],
  ["deadline", /thời hạn|ngày làm việc|chậm nhất/iu],
  ["numbers", /\d+\s*%|\d[\d.,]*\s*(?:đồng|triệu|tỷ)|mức phạt/iu],
  ["effective", /hiệu lực|có hiệu lực từ/iu],
  ["transition", /chuyển tiếp/iu],
  ["forms", /phụ lục|mẫu số|biểu mẫu/iu],
];

export function detectVideoCoverage(document: DocumentDetail) {
  const source = `${document.title}\n${document.official_text}`;
  const categories = COVERAGE_PATTERNS.filter(([, pattern]) => pattern.test(source)).map(([category]) => category);
  return Array.from(new Set<LegalVideoCategory>(["overview", ...categories]));
}

export function splitVietnameseTtsText(text: string, targetChars = 1_100, maxChars = 1_450) {
  const normalized = text.replace(SPACE, " ").trim();
  if (!normalized) return [];
  const sentences = normalized.split(/(?<=[.!?;:])\s+/gu).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > targetChars) {
      chunks.push(current);
      current = "";
    }
    if (sentence.length <= maxChars) {
      current = [current, sentence].filter(Boolean).join(" ");
      continue;
    }
    const clauses = sentence.split(/(?<=[,])\s+/gu);
    for (const clause of clauses) {
      if (current && current.length + clause.length + 1 > maxChars) {
        chunks.push(current);
        current = "";
      }
      if (clause.length <= maxChars) {
        current = [current, clause].filter(Boolean).join(" ");
        continue;
      }
      for (let offset = 0; offset < clause.length; offset += maxChars) {
        const part = clause.slice(offset, offset + maxChars).trim();
        if (part) chunks.push(part);
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
