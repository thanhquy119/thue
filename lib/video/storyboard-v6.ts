import {
  createLegalVideoStoryboard as createBaseStoryboard,
  summarizeVideoEvidenceSection,
} from "./storyboard";
import type {LegalVideoStoryboard} from "./types";

export {summarizeVideoEvidenceSection};

function cleanCaptionText(value: string) {
  return value
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .trim();
}

function rebalanceSentenceChunks(
  input: string[],
  maxChars: number,
  tolerance = 28,
  minimumTail = 34,
) {
  if (input.length < 2) return input.filter(Boolean);
  const chunks = [...input];
  const lastIndex = chunks.length - 1;
  let previousWords = chunks[lastIndex - 1].split(/\s+/gu).filter(Boolean);
  let tailWords = chunks[lastIndex].split(/\s+/gu).filter(Boolean);
  const lengthOf = (words: string[]) => words.join(" ").length;

  while (lengthOf(tailWords) < minimumTail && previousWords.length > 1) {
    const moved = previousWords.at(-1);
    if (!moved) break;
    const candidateTail = [moved, ...tailWords];
    if (lengthOf(candidateTail) > maxChars + tolerance) break;
    previousWords = previousWords.slice(0, -1);
    tailWords = candidateTail;
  }

  chunks[lastIndex - 1] = previousWords.join(" ");
  chunks[lastIndex] = tailWords.join(" ");
  return chunks.filter(Boolean);
}

function splitSentenceByWords(sentence: string, maxChars: number) {
  const words = cleanCaptionText(sentence).split(/\s+/gu).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = [current, word].filter(Boolean).join(" ");
    if (current && candidate.length > maxChars) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return rebalanceSentenceChunks(chunks, maxChars);
}

/**
 * Tạo phụ đề theo từng câu độc lập. Việc cân bằng độ dài chỉ diễn ra giữa
 * các mảnh của cùng một câu, nên phần đầu câu sau không thể bị kéo vào cuối
 * caption trước như trường hợp "... tương ứng. Người nộp thuế".
 */
export function captionChunksBySentence(value: string, maxChars = 116) {
  const normalized = cleanCaptionText(value);
  if (!normalized) return [];
  const sentences = normalized
    .split(/(?<=[.!?])\s+/gu)
    .map(cleanCaptionText)
    .filter(Boolean);

  return (sentences.length ? sentences : [normalized]).flatMap((sentence) =>
    sentence.length <= maxChars ? [sentence] : splitSentenceByWords(sentence, maxChars),
  );
}

export function normalizeStoryboardCaptions(storyboard: LegalVideoStoryboard): LegalVideoStoryboard {
  return {
    ...storyboard,
    scenes: storyboard.scenes.map((scene) => ({
      ...scene,
      captionChunks: captionChunksBySentence(scene.narration),
    })),
  };
}

export async function createLegalVideoStoryboard(
  input: Parameters<typeof createBaseStoryboard>[0],
): Promise<LegalVideoStoryboard> {
  return normalizeStoryboardCaptions(await createBaseStoryboard(input));
}
