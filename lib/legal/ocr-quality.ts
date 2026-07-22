export type OcrQualityDraft = {
  text: string;
  score: number;
  pass: "literal" | "structure" | "consensus";
};

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeSpaces(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanOcrTextForQuality(value: string) {
  return normalizeSpaces(
    value
      .replace(/```(?:text|markdown)?/giu, "")
      .replace(/^\s*(?:KẾT QUẢ OCR|BẢN CHÉP|TRANSCRIPTION)\s*:?[ \t]*$/gimu, "")
      .replace(/^\s*(?:---\s*)?(?:TRANG|PAGE)\s+\d+(?:\s*\/\s*\d+)?(?:\s*---)?\s*$/gimu, "")
      .replace(/^\s*\[?không có nội dung\]?\s*$/gimu, ""),
  );
}

export function scoreLegalOcrTextForQuality(value: string) {
  const text = cleanOcrTextForQuality(value);
  if (!text) return 0;

  const letters = text.match(/\p{L}/gu) ?? [];
  const digits = text.match(/\d/g) ?? [];
  const vietnamese = text.match(/[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/giu) ?? [];
  const legalMarkers = text.match(
    /(?:CỘNG HÒA|Độc lập|Số\s*:|Nghị định|Thông tư|Nghị quyết|Quyết định|Luật|Căn cứ|Chương|Mục|Điều|Khoản|Điểm)/giu,
  ) ?? [];
  const suspicious = text.match(/[�□■◆◇]|\?{2,}|\b(?:lJ|I0|O0|0O)\b/g) ?? [];
  const brokenTokens = text.match(/\b\p{L}\s+\p{L}\s+\p{L}\b/gu) ?? [];

  const lengthScore = clamp(text.length / 1_400);
  const legalScore = clamp(legalMarkers.length / 5);
  const vietnameseScore = clamp(vietnamese.length / 24);
  const readableRatio = clamp((letters.length + digits.length) / Math.max(1, text.length) / 0.72);
  const lineScore = clamp(text.split("\n").filter((line) => line.trim().length >= 8).length / 12);
  const penalty = clamp((suspicious.length * 4 + brokenTokens.length * 2) / Math.max(20, text.length) * 8);

  return clamp(
    0.08 +
      lengthScore * 0.25 +
      legalScore * 0.26 +
      vietnameseScore * 0.15 +
      readableRatio * 0.16 +
      lineScore * 0.1 -
      penalty * 0.35,
  );
}

function normalizedTokens(value: string) {
  return cleanOcrTextForQuality(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/giu, "d")
    .toLocaleLowerCase("vi")
    .match(/[a-z0-9]+/g) ?? [];
}

export function ocrTokenSimilarityForQuality(left: string, right: string) {
  const leftTokens = new Set(normalizedTokens(left));
  const rightTokens = new Set(normalizedTokens(right));
  if (!leftTokens.size && !rightTokens.size) return 1;
  if (!leftTokens.size || !rightTokens.size) return 0;

  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

export function selectBestOcrDraftForQuality(drafts: OcrQualityDraft[]) {
  if (!drafts.length) throw new Error("Không có bản OCR để so sánh.");
  return [...drafts].sort((left, right) => {
    const scoreDifference = right.score - left.score;
    if (Math.abs(scoreDifference) > 0.015) return scoreDifference;
    if (left.pass === "consensus" && right.pass !== "consensus") return -1;
    if (right.pass === "consensus" && left.pass !== "consensus") return 1;
    return right.text.length - left.text.length;
  })[0];
}

function normalizeEdgeLine(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/giu, "d")
    .toLocaleLowerCase("vi")
    .replace(/\d+/g, "#")
    .replace(/[^a-z#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isStructuralLegalLine(value: string) {
  return /(?:cộng hòa|độc lập|nghị định|thông tư|nghị quyết|quyết định|luật|chương|mục|điều|căn cứ)/iu.test(value);
}

export function removeRepeatedPageEdgesForQuality(pageTexts: string[]) {
  if (pageTexts.length < 2) return pageTexts.map(cleanOcrTextForQuality);

  const candidates = new Map<string, number>();
  const splitPages = pageTexts.map((page) => cleanOcrTextForQuality(page).split("\n").map((line) => line.trim()).filter(Boolean));
  for (const lines of splitPages) {
    const edges = [...lines.slice(0, 2), ...lines.slice(-2)];
    const unique = new Set(edges.map(normalizeEdgeLine).filter((line) => line.length >= 3 && line.length <= 90));
    for (const line of unique) candidates.set(line, (candidates.get(line) ?? 0) + 1);
  }

  const threshold = Math.max(2, Math.ceil(pageTexts.length * 0.67));
  const repeated = new Set(
    [...candidates.entries()]
      .filter(([line, count]) => count >= threshold && !isStructuralLegalLine(line))
      .map(([line]) => line),
  );

  return splitPages.map((lines) =>
    lines.filter((line) => !repeated.has(normalizeEdgeLine(line))).join("\n").trim(),
  );
}
