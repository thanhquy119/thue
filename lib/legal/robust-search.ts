import { searchTaxLaw } from "./search";
import { extractSearchHint, lexicalRelevance, normalizeLegalQuery } from "./query";
import { disqualifyTaxSource } from "./tax-source-disqualifier";
import { taxSourceRelevance } from "./tax-source-relevance";
import type { SearchCandidate, SearchHint, TaxSearchResponse } from "./types";

const TYPE_WORDS = /\b(?:nghi dinh|thong tu|nghi quyet|quyet dinh|luat|nd-cp|tt-btc|nd|tt|nq|qd)\b/g;

function normalizeNumber(value: string) {
  return normalizeLegalQuery(value).replace(/\s+/g, "");
}

function descriptor(query: string, hint: SearchHint) {
  let value = hint.normalized
    .replace(/\b\d{1,4}\s*[/-]\s*20\d{2}\s*[/-]\s*(?:nd-cp|tt-[a-z0-9-]+|nq-[a-z0-9-]+|qd-[a-z0-9-]+|qh\d*|ubtvqh\d*)\b/g, " ")
    .replace(TYPE_WORDS, " ")
    .replace(/\b(?:so|nam)\b/g, " ");
  if (hint.number) value = value.replace(new RegExp(`\\b${hint.number}\\b`, "g"), " ");
  if (hint.year) value = value.replace(new RegExp(`\\b${hint.year}\\b`, "g"), " ");
  return value.replace(/\s+/g, " ").trim();
}

function matchesHint(number: string, type: string, hint: SearchHint) {
  const normalizedNumber = normalizeNumber(number);
  const normalizedType = normalizeLegalQuery(type);
  const numberMatches = !hint.number || new RegExp(`(?:^|[^0-9])${hint.number}(?:/|[^0-9]|$)`).test(normalizedNumber);
  const yearMatches = !hint.year || normalizedNumber.includes(hint.year);
  const typeMatches = !hint.type || normalizedType.includes(normalizeLegalQuery(hint.type));
  return numberMatches && yearMatches && typeMatches;
}

function candidateScore(query: string, candidate: SearchCandidate, hint: SearchHint) {
  let score = lexicalRelevance(
    query,
    `${candidate.number} ${candidate.type} ${candidate.title} ${candidate.issuer}`,
  );
  if (hint.number && new RegExp(`(?:^|[^0-9])${hint.number}(?:/|[^0-9]|$)`).test(normalizeNumber(candidate.number))) score += 3;
  if (hint.year && normalizeNumber(candidate.number).includes(hint.year)) score += 2;
  if (hint.type && normalizeLegalQuery(candidate.type).includes(normalizeLegalQuery(hint.type))) score += 1;
  return score;
}

function bestCandidate(query: string, result: TaxSearchResponse, hint: SearchHint) {
  return [...(result.candidates ?? [])]
    .filter((candidate) => matchesHint(candidate.number, candidate.type, hint))
    .map((candidate) => ({ candidate, score: candidateScore(query, candidate, hint) }))
    .sort((left, right) => right.score - left.score)[0] ?? null;
}

function attemptQueries(query: string, hint: SearchHint) {
  const title = descriptor(query, hint);
  const identifier = hint.number ? `${hint.number}${hint.year ? `/${hint.year}` : ""}` : "";
  const variants: string[] = [];

  if (hint.type && identifier && title) {
    variants.push(`${hint.type} ${identifier} ${title}`);
    variants.push(`${hint.type} ${title}`);
    variants.push(`${hint.type} ${title} ${identifier}`);
  }
  variants.push(query);
  if (hint.type && identifier) variants.push(`${hint.type} ${identifier}`);

  return Array.from(new Set(variants.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))).slice(0, 4);
}

function exactCandidates(result: TaxSearchResponse | null, hint: SearchHint) {
  if (!result) return [];
  return (result.candidates ?? []).filter((candidate) => matchesHint(candidate.number, candidate.type, hint));
}

function noExactMatchResponse(query: string, hint: SearchHint, result: TaxSearchResponse | null): TaxSearchResponse {
  const candidates = exactCandidates(result, hint);
  const expected = [hint.type, hint.number, hint.year].filter(Boolean).join(" ");
  return {
    query_normalized: hint.normalized,
    query_kind: "document",
    direct_answer: `Chưa tìm thấy văn bản ${expected || query} khớp chính xác về loại, số và năm trên các nguồn đang truy cập. Hệ thống không mở một văn bản gần giống để tránh nhầm căn cứ pháp lý.`,
    document: null,
    candidates,
    warnings: result?.warnings ?? [],
    confidence: candidates.length ? 0.68 : 0.25,
    retrieved_at: result?.retrieved_at ?? new Date().toISOString(),
  };
}

function guardQuestionResult(query: string, result: TaxSearchResponse): TaxSearchResponse {
  const document = result.document;
  if (!document) return result;

  const fullText = `${document.number} ${document.type} ${document.title} ${document.issuer} ${document.official_text.slice(0, 40_000)}`;
  const relevance = taxSourceRelevance(query, fullText);
  if (!disqualifyTaxSource(query, fullText) && relevance >= 1.4) return result;

  return {
    ...result,
    direct_answer:
      "Chưa tìm thấy văn bản chính thức đủ phù hợp với đúng đối tượng và nghiệp vụ để kết luận an toàn. Hệ thống đã loại các nguồn chỉ bãi bỏ văn bản cũ, nguồn khác đối tượng hoặc nguồn chỉ gần giống từ khóa. Vui lòng bổ sung tình huống cụ thể hơn hoặc nêu số hiệu văn bản cần đối chiếu.",
    document: null,
    candidates: [],
    warnings: [],
    confidence: 0.28,
  };
}

/**
 * Resolve natural document names without maintaining a table of aliases.
 * Examples: “Luật quản lý thuế 108”, “Luật 108 quản lý thuế”, and a full
 * identifier all converge on the same official-document search flow.
 */
export async function searchTaxLawRobust(query: string): Promise<TaxSearchResponse> {
  const hint = extractSearchHint(query);
  if (hint.asksQuestion) return guardQuestionResult(query, await searchTaxLaw(query));
  if (!hint.type) return searchTaxLaw(query);

  let bestResult: TaxSearchResponse | null = null;
  let bestResultScore = -Infinity;

  for (const attempt of attemptQueries(query, hint)) {
    const result = await searchTaxLaw(attempt);

    if (result.document && matchesHint(result.document.number, result.document.type, hint)) {
      const score =
        candidateScore(query, {
          id: result.document.id,
          number: result.document.number,
          title: result.document.title,
          type: result.document.type,
          issuer: result.document.issuer,
          issued_date: result.document.issued_date,
          source_url: result.document.source_url,
          source_label: result.document.source_label,
        }, hint) + 5;
      const matchingResult: TaxSearchResponse = { ...result, query_normalized: hint.normalized };
      if (score > bestResultScore) {
        bestResult = matchingResult;
        bestResultScore = score;
      }
      if (score >= 8) return matchingResult;
    }

    const rankedCandidate = bestCandidate(query, result, hint);
    if (rankedCandidate && rankedCandidate.score >= 4.2) {
      const opened = await searchTaxLaw(rankedCandidate.candidate.number);
      if (opened.document && matchesHint(opened.document.number, opened.document.type, hint)) {
        return { ...opened, query_normalized: hint.normalized };
      }
    }

    const fallbackScore = rankedCandidate?.score ?? (result.document ? 1 : 0);
    if (fallbackScore > bestResultScore) {
      bestResult = { ...result, query_normalized: hint.normalized };
      bestResultScore = fallbackScore;
    }
  }

  // Với truy vấn có số văn bản, thà trả về “chưa tìm thấy chính xác” còn hơn
  // hiển thị một văn bản khác chỉ vì tiêu đề có vài từ giống nhau.
  if (hint.number) return noExactMatchResponse(query, hint, bestResult);
  return bestResult ?? searchTaxLaw(query);
}
