import { analyzeTaxQuestion } from "./question-intelligence.ts";
import { searchGroundingEnabled } from "./search-grounding-fallback.ts";
import { taxSourceRelevance } from "./tax-source-relevance.ts";
import type { OnlineLegalSource } from "./types.ts";

export type GroundingCrossCheckResult = {
  sources: OnlineLegalSource[];
  matchCount: number;
  newSourceCount: number;
  conflicts: string[];
  warnings: string[];
};

const FULL_DOCUMENT_NUMBER =
  /\b\d{1,4}\s*\/\s*20\d{2}\s*\/\s*(?:NĐ-CP|ND-CP|TT-[A-ZĐ0-9-]+|NQ-[A-ZĐ0-9-]+|QĐ-[A-ZĐ0-9-]+|QD-[A-Z0-9-]+|QH\d*|UBTVQH\d*)\b/iu;
const HIGH_RISK_INTENTS = new Set([
  "thuế suất, mức thuế và cách tính",
  "ngưỡng doanh thu, miễn thuế, không chịu thuế",
  "thời hạn khai, nộp và xử lý",
  "xử phạt, tiền chậm nộp và cưỡng chế",
  "sửa đổi, bổ sung, thay thế và đối chiếu",
]);
const HIGH_RISK_TERMS =
  /\b(?:dieu kien|ap dung|hien hanh|con hieu luc|het hieu luc|mien|khong chiu|khong phai nop|bao nhieu|muc phat|thoi han|han nop|thue suat|nguong)\b/;
const GROUNDING_MATCH_BOOST = 1.15;

function cleanDocumentNumber(value: string) {
  return value
    .replace(/\s+/g, "")
    .replace(/ND-CP/iu, "NĐ-CP")
    .replace(/^QD-/iu, "QĐ-")
    .toLocaleUpperCase("vi");
}

export function normalizeOfficialDocumentNumber(value: string) {
  const match = value.match(FULL_DOCUMENT_NUMBER)?.[0];
  return match ? cleanDocumentNumber(match) : "";
}

export function normalizeOfficialSourceUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "";
    url.hash = "";
    url.hostname = url.hostname.toLocaleLowerCase("en").replace(/^www\./, "");
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$|ref$|source$)/iu.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return "";
  }
}

function sourceDocumentNumber(source: OnlineLegalSource) {
  return normalizeOfficialDocumentNumber(
    `${source.document_number ?? ""} ${source.title} ${source.url}`,
  );
}

function sourceText(source: OnlineLegalSource) {
  return `${source.document_number ?? ""} ${source.document_type ?? ""} ${source.title} ${source.snippet} ${source.issuer ?? ""}`;
}

export function isHighRiskTaxQuestion(query: string) {
  const plan = analyzeTaxQuestion(query);
  if (!plan.isQuestion || plan.hasDocumentReference) return false;
  return plan.intents.some((intent) => HIGH_RISK_INTENTS.has(intent)) || HIGH_RISK_TERMS.test(plan.normalized);
}

export function shouldCrossCheckWithGrounding(
  query: string,
  directSources: OnlineLegalSource[],
  minimumRelevance = 0.6,
) {
  if (!searchGroundingEnabled() || !isHighRiskTaxQuestion(query)) return false;
  if (!directSources.length) return true;

  const numberedSources = directSources.filter((source) => sourceDocumentNumber(source));
  const hasStrongNumberedSource = numberedSources.some(
    (source) => taxSourceRelevance(query, sourceText(source)) >= minimumRelevance + 1.2,
  );

  return directSources.length < 2 || numberedSources.length === 0 || !hasStrongNumberedSource;
}

function confirmedSource(source: OnlineLegalSource) {
  return {
    ...source,
    score: source.score + GROUNDING_MATCH_BOOST,
    source_label: /Search Grounding/iu.test(source.source_label)
      ? source.source_label
      : `${source.source_label} · đối chiếu Search Grounding`,
  };
}

export function crossCheckOfficialSources(
  directSources: OnlineLegalSource[],
  groundedSources: OnlineLegalSource[],
): GroundingCrossCheckResult {
  const sources = directSources.map((source) => ({ ...source }));
  const conflicts: string[] = [];
  let matchCount = 0;
  let newSourceCount = 0;

  for (const grounded of groundedSources) {
    const groundedUrl = normalizeOfficialSourceUrl(grounded.url);
    const groundedNumber = sourceDocumentNumber(grounded);
    const urlMatchIndex = sources.findIndex(
      (source) => groundedUrl && normalizeOfficialSourceUrl(source.url) === groundedUrl,
    );
    const numberMatchIndex = sources.findIndex(
      (source) => groundedNumber && sourceDocumentNumber(source) === groundedNumber,
    );

    if (urlMatchIndex >= 0) {
      const directNumber = sourceDocumentNumber(sources[urlMatchIndex]);
      if (directNumber && groundedNumber && directNumber !== groundedNumber) {
        conflicts.push(
          `Cùng URL chính thức nhưng metadata ghi hai số hiệu khác nhau: ${directNumber} và ${groundedNumber}.`,
        );
        continue;
      }
      sources[urlMatchIndex] = confirmedSource(sources[urlMatchIndex]);
      matchCount += 1;
      continue;
    }

    if (numberMatchIndex >= 0) {
      sources[numberMatchIndex] = confirmedSource(sources[numberMatchIndex]);
      matchCount += 1;
      continue;
    }

    if (!groundedUrl || sources.some((source) => normalizeOfficialSourceUrl(source.url) === groundedUrl)) continue;
    sources.push({ ...grounded });
    newSourceCount += 1;
  }

  const warnings = conflicts.length
    ? [
        "Nguồn trực tiếp và Search Grounding có metadata mâu thuẫn. Hệ thống chỉ được kết luận sau khi tải và xác minh toàn văn từ URL chính thức.",
      ]
    : [];

  return {
    sources,
    matchCount,
    newSourceCount,
    conflicts,
    warnings,
  };
}
