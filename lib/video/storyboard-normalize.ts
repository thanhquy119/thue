import type {LegalVideoScene} from "./types";

const VIETNAMESE_MARKS = /[ăâđêôơưà-ỹ]/iu;
const LETTER_TOKEN = /[A-Za-zÀ-ỹĐđ]+/gu;

export function cleanVideoDisplayText(value: string) {
  return value
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .trim();
}

function isMetadataLabel(value: string) {
  const text = cleanVideoDisplayText(value);
  return /^[A-ZĐ0-9/ .:–—-]+$/u.test(text)
    || /^(?:Thông tư|Nghị định|Quyết định|Luật)(?:\s+số)?(?:\s+[\d/.-]+[A-ZĐ-]*)?$/iu.test(text);
}

export function hasReliableVietnameseDiacritics(value: string) {
  const text = cleanVideoDisplayText(value);
  if (!text) return false;
  if (isMetadataLabel(text)) return true;

  const tokens = text.match(LETTER_TOKEN) ?? [];
  const lexicalTokens = tokens.filter((token) => token.length >= 2 && !/^[A-Z]{2,8}$/u.test(token));
  if (!lexicalTokens.length) return true;

  const markedTokens = lexicalTokens.filter((token) => VIETNAMESE_MARKS.test(token)).length;
  if (lexicalTokens.length <= 3) return markedTokens >= 1;
  return markedTokens >= 2 && markedTokens / lexicalTokens.length >= 0.18;
}

function canonicalVideoText(value: string) {
  return cleanVideoDisplayText(value)
    .replace(/[.!?;:,…]+$/gu, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/đ/giu, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9%]+/gu, " ")
    .trim();
}

function tokenSet(value: string) {
  return new Set(canonicalVideoText(value).split(/\s+/gu).filter((token) => token.length > 1));
}

export function visualTextSimilarity(left: string, right: string) {
  const aText = canonicalVideoText(left);
  const bText = canonicalVideoText(right);
  if (!aText || !bText) return 0;
  if (aText === bText) return 1;

  const shorter = aText.length <= bText.length ? aText : bText;
  const longer = aText.length > bText.length ? aText : bText;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.68) return 0.95;

  const a = tokenSet(aText);
  const b = tokenSet(bText);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const containment = intersection / Math.min(a.size, b.size);
  const jaccard = intersection / (a.size + b.size - intersection);
  return Math.max(containment * 0.9, jaccard);
}

function completeVisualText(value: string) {
  const text = cleanVideoDisplayText(value).replace(/[.!?;:,…]+$/gu, "").trim();
  const words = text.split(/\s+/gu).filter(Boolean);
  return text.length >= 8
    && (/[0-9]/u.test(text) || words.length >= 2)
    && !/\b(?:và|hoặc|tại|trong|của|với|theo|để|do|bởi|từ|quản|trụ)$/iu.test(text)
    && hasReliableVietnameseDiacritics(text);
}

export function dedupeVisualTexts(values: string[], limit = 3) {
  const result: string[] = [];
  for (const raw of values) {
    const text = cleanVideoDisplayText(raw).replace(/[.!?;:,…]+$/gu, "").trim();
    if (!completeVisualText(text)) continue;
    if (result.some((existing) => visualTextSimilarity(existing, text) >= 0.72)) continue;
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function sentenceCandidates(value: string) {
  return cleanVideoDisplayText(value)
    .split(/(?<=[.!?])\s+/gu)
    .map(cleanVideoDisplayText)
    .filter(Boolean);
}

function ensureSentence(value: string) {
  const text = cleanVideoDisplayText(value);
  return !text || /[.!?]$/u.test(text) ? text : `${text}.`;
}

export function normalizeSceneForVideo(scene: LegalVideoScene): LegalVideoScene {
  let bullets = dedupeVisualTexts(scene.bullets, 3);
  if (!bullets.length) bullets = dedupeVisualTexts(sentenceCandidates(scene.narration), 3);

  let narration = cleanVideoDisplayText(scene.narration);
  if (!hasReliableVietnameseDiacritics(narration) && bullets.length) {
    narration = bullets.map(ensureSentence).join(" ");
  }

  let title = cleanVideoDisplayText(scene.title);
  if (!hasReliableVietnameseDiacritics(title) && !isMetadataLabel(title)) {
    const fallback = bullets.find((item) => item.length <= 78)
      ?? sentenceCandidates(narration).find((item) => item.length <= 78 && hasReliableVietnameseDiacritics(item));
    if (fallback) title = fallback.replace(/[.!?]+$/u, "");
  }

  const visualLimit = scene.visualMode === "network" || scene.kind === "audience" ? 2 : 3;
  let visualKeywords = dedupeVisualTexts([
    ...(scene.visualKeywords ?? []),
    ...bullets,
  ], visualLimit);
  if (!visualKeywords.length) visualKeywords = bullets.slice(0, visualLimit);

  return {
    ...scene,
    title,
    bullets,
    narration,
    visualKeywords,
  };
}
