import { normalizeLegalDocumentText } from "./legal-text-normalization.ts";
import type { DocumentDetail, ProvisionDetail } from "./types.ts";

const ARTICLE_PATTERN = /^\s*Điều\s+(\d+[a-zA-Z]?)\s*[.:]?\s*([^\n]*)$/gimu;

const SIGNATURE_BOUNDARIES = [
  /(\.\s*\/.\s*)(?=(?:(?:KT|TM|TL|TUQ)\.\s*)?(?:BỘ TRƯỞNG|THỦ TƯỚNG(?: CHÍNH PHỦ)?|CHỦ TỊCH|PHÓ CHỦ TỊCH|TỔNG CỤC TRƯỞNG|CỤC TRƯỞNG|TỔNG KIỂM TOÁN NHÀ NƯỚC|CHÁNH ÁN|VIỆN TRƯỞNG)\b)/imu,
  /(^|\n)(?=(?:KT|TM|TL|TUQ)\.\s*(?:BỘ TRƯỞNG|THỦ TƯỚNG(?: CHÍNH PHỦ)?|CHỦ TỊCH|PHÓ CHỦ TỊCH|TỔNG CỤC TRƯỞNG|CỤC TRƯỞNG|TỔNG KIỂM TOÁN NHÀ NƯỚC|CHÁNH ÁN|VIỆN TRƯỞNG)\b)/imu,
  /(^|\n)(?=Nơi\s+nhận\s*:)/imu,
];

const APPENDIX_BOUNDARIES = [
  /(^|\n)(?=(?:PHỤ\s+LỤC|MẪU\s+SỐ|DANH\s+MỤC)\b)/imu,
  /(\s+)(?=(?:PHỤ\s+LỤC|Phụ\s+lục)\s*\(\s*Kèm\s+theo\b)/imu,
];

function normalizeText(value: string) {
  return normalizeLegalDocumentText(value);
}

function matchesArticles(value: string) {
  return [...value.matchAll(new RegExp(ARTICLE_PATTERN.source, ARTICLE_PATTERN.flags))];
}

function boundaryIndex(value: string, patterns: RegExp[], minimum = 0) {
  const sample = value.slice(minimum);
  let earliest = -1;

  for (const pattern of patterns) {
    const match = sample.match(pattern);
    if (!match || match.index == null) continue;
    const index = minimum + match.index + (match[1]?.length ?? 0);
    if (earliest < 0 || index < earliest) earliest = index;
  }

  return earliest;
}

function tailBoundary(value: string, minimum: number) {
  const signature = boundaryIndex(value, SIGNATURE_BOUNDARIES, minimum);
  const appendix = boundaryIndex(value, APPENDIX_BOUNDARIES, minimum);
  if (signature < 0) return appendix;
  if (appendix < 0) return signature;
  return Math.min(signature, appendix);
}

function existingId(
  document: DocumentDetail,
  type: ProvisionDetail["type"],
  identifier: string | null,
  fallback: string,
) {
  return document.provisions.find(
    (provision) => provision.type === type && provision.identifier === identifier,
  )?.id ?? `${document.id}-display-${fallback}`;
}

function tailProvisions(document: DocumentDetail, tail: string, startOrder: number) {
  const normalized = normalizeText(tail);
  if (!normalized) return [];

  const appendixStart = boundaryIndex(normalized, APPENDIX_BOUNDARIES);
  const signatureText = appendixStart > 0 ? normalizeText(normalized.slice(0, appendixStart)) : appendixStart === 0 ? "" : normalized;
  const appendixText = appendixStart >= 0 ? normalizeText(normalized.slice(appendixStart)) : "";
  const provisions: ProvisionDetail[] = [];

  if (signatureText) {
    provisions.push({
      id: existingId(document, "other", "Phần ký và nơi nhận", "signature"),
      type: "other",
      identifier: "Phần ký và nơi nhận",
      article: null,
      heading: null,
      official_text: signatureText,
      order_index: startOrder,
    });
  }

  if (appendixText) {
    provisions.push({
      id: existingId(document, "other", "Phụ lục", "appendix"),
      type: "other",
      identifier: "Phụ lục",
      article: null,
      heading: null,
      official_text: appendixText,
      order_index: startOrder + 100,
    });
  }

  return provisions;
}

function headingFromFirstBodyLine(body: string) {
  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
  const first = lines[0] ?? "";
  const words = first.split(/\s+/u).filter(Boolean);
  const looksLikeSentence = /[.;:]$/u.test(first) || /\b(?:là|được|quy định|bao gồm|thực hiện|có trách nhiệm|áp dụng|phải|không được)\b/iu.test(first);
  if (lines.length < 2 || first.length > 160 || words.length < 2 || words.length > 14 || looksLikeSentence) {
    return { heading: null, body };
  }
  return {
    heading: first,
    body: normalizeText(lines.slice(1).join("\n")),
  };
}

export function rebuildPresentationProvisions(document: DocumentDetail): ProvisionDetail[] {
  const text = normalizeText(document.official_text);
  const initialArticles = matchesArticles(text);
  if (!text || !initialArticles.length) return document.provisions;

  const firstArticleStart = initialArticles[0].index ?? 0;
  const splitAt = tailBoundary(text, firstArticleStart);
  const mainText = splitAt >= 0 ? normalizeText(text.slice(0, splitAt)) : text;
  const tail = splitAt >= 0 ? text.slice(splitAt) : "";
  const articles = matchesArticles(mainText);
  if (!articles.length) return document.provisions;

  const provisions: ProvisionDetail[] = [];
  const preamble = normalizeText(mainText.slice(0, articles[0].index ?? 0));
  if (preamble) {
    provisions.push({
      id: existingId(document, "preamble", "Phần mở đầu", "preamble"),
      type: "preamble",
      identifier: "Phần mở đầu",
      article: null,
      heading: null,
      official_text: preamble,
      order_index: 0,
    });
  }

  for (let index = 0; index < articles.length; index += 1) {
    const match = articles[index];
    const headingStart = match.index ?? 0;
    const headingEnd = headingStart + match[0].length;
    const nextStart = articles[index + 1]?.index ?? mainText.length;
    const article = match[1];
    const identifier = `Điều ${article}`;
    const rawBody = normalizeText(mainText.slice(headingEnd, nextStart));
    const inlineHeading = match[2]?.trim() || null;
    const inferred = inlineHeading ? { heading: inlineHeading, body: rawBody } : headingFromFirstBodyLine(rawBody);

    provisions.push({
      id: existingId(document, "article", identifier, `article-${article}`),
      type: "article",
      identifier,
      article,
      heading: inferred.heading,
      official_text: inferred.body,
      order_index: (index + 1) * 100,
    });
  }

  provisions.push(...tailProvisions(document, tail, (articles.length + 1) * 100));
  return provisions;
}

export function prepareDocumentForPresentation(document: DocumentDetail): DocumentDetail {
  const officialText = normalizeText(document.official_text);
  return {
    ...document,
    official_text: officialText,
    verification_notes: null,
    provisions: rebuildPresentationProvisions({ ...document, official_text: officialText }),
  };
}
