import { answerQuestionFromAnchors } from "./anchored-question";
import { discoverOfficialSources } from "./gemini";
import {
  findLatestLegalUpdate,
  legalUpdateDescription,
  relationCandidate,
} from "./legal-update-relations";
import { searchTaxLaw } from "./search";
import { extractSearchHint, lexicalRelevance, normalizeLegalQuery } from "./query";
import { disqualifyTaxSource } from "./tax-source-disqualifier";
import { taxSourceRelevance } from "./tax-source-relevance";
import { ensureBinaryConclusion, verifiedQuestionResponse } from "./verified-question-rules";
import type { SearchCandidate, SearchHint, TaxSearchResponse } from "./types";

const TYPE_WORDS = /\b(?:nghi dinh|thong tu|nghi quyet|quyet dinh|luat|nd-cp|tt-btc|nd|tt|nq|qd)\b/g;
const INTERNAL_CONTEXT_MARKER = /\s+Ngữ cảnh tra cứu pháp lý:/iu;

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

function originalUserQuery(query: string, explicitlyProvided?: string) {
  if (explicitlyProvided?.trim()) return explicitlyProvided.trim();
  return query.split(INTERNAL_CONTEXT_MARKER)[0]?.trim() || query.trim();
}

function guardQuestionResult(originalQuery: string, result: TaxSearchResponse): TaxSearchResponse {
  const document = result.document;
  if (!document) return result;

  const fullText = `${document.number} ${document.type} ${document.title} ${document.issuer} ${document.official_text.slice(0, 40_000)}`;
  const relevance = taxSourceRelevance(originalQuery, fullText);
  if (!disqualifyTaxSource(originalQuery, fullText) && relevance >= 1.4) return result;

  return {
    ...result,
    query_normalized: normalizeLegalQuery(originalQuery),
    direct_answer:
      "Chưa tìm thấy văn bản chính thức đủ phù hợp với đúng đối tượng và nghiệp vụ để kết luận an toàn. Hệ thống đã loại các nguồn chỉ bãi bỏ văn bản cũ, nguồn khác đối tượng hoặc nguồn chỉ gần giống từ khóa. Vui lòng bổ sung tình huống cụ thể hơn hoặc nêu số hiệu văn bản cần đối chiếu.",
    document: null,
    candidates: [],
    warnings: [],
    confidence: 0.28,
  };
}

function asksHistoricalPeriod(query: string) {
  const currentYear = new Date().getFullYear();
  const years = normalizeLegalQuery(query).match(/\b20\d{2}\b/g) ?? [];
  return years.some((year) => Number(year) < currentYear);
}

function asksAboutLegalRelationship(query: string) {
  return /\b(?:sua doi|bo sung|thay the|bai bo|het hieu luc|van ban nao thay)\b/.test(
    normalizeLegalQuery(query),
  );
}

function uniqueCandidates(candidates: SearchCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = normalizeNumber(candidate.number);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function updateUnavailableResponse(
  query: string,
  result: TaxSearchResponse,
  candidate: SearchCandidate,
  message: string,
): TaxSearchResponse {
  return {
    ...result,
    query_normalized: normalizeLegalQuery(query),
    direct_answer:
      `Chưa thể kết luận theo văn bản hiện tại. ${message} ` +
      "Hệ thống chưa mở được đầy đủ văn bản mới để đối chiếu nên không tiếp tục áp dụng riêng căn cứ cũ.",
    document: null,
    candidates: uniqueCandidates([candidate, ...(result.candidates ?? [])]),
    warnings: Array.from(
      new Set([
        ...result.warnings,
        "Đã phát hiện dấu hiệu cập nhật pháp lý mới hơn nhưng chưa đủ toàn văn để xác minh nội dung áp dụng.",
      ]),
    ),
    confidence: Math.min(result.confidence, 0.38),
  };
}

async function guardCurrentLawUpdate(
  userQuery: string,
  result: TaxSearchResponse,
): Promise<TaxSearchResponse> {
  const document = result.document;
  if (!document || result.query_kind !== "question") return result;
  if (asksHistoricalPeriod(userQuery) || asksAboutLegalRelationship(userQuery)) return result;

  try {
    const discovery = await discoverOfficialSources(
      `${document.number} sửa đổi bổ sung thay thế bãi bỏ`,
    );
    const relation = findLatestLegalUpdate(document, discovery.sources);
    if (!relation) return result;

    const candidate = relationCandidate(relation);
    const description = legalUpdateDescription(relation.kind);
    if (relation.kind === "repeal") {
      return updateUnavailableResponse(
        userQuery,
        result,
        candidate,
        `${candidate.number} có dấu hiệu ${description} ${document.number}.`,
      );
    }

    const opened = await searchTaxLaw(relation.documentNumber);
    const updatedDocument = opened.document;
    if (!updatedDocument || normalizeNumber(updatedDocument.number) !== normalizeNumber(relation.documentNumber)) {
      return updateUnavailableResponse(
        userQuery,
        result,
        candidate,
        `${candidate.number} có dấu hiệu ${description} ${document.number}.`,
      );
    }

    if (updatedDocument.status === "upcoming") {
      return {
        ...result,
        warnings: Array.from(
          new Set([
            ...result.warnings,
            `${updatedDocument.number} đã được ban hành để ${description} ${document.number} nhưng chưa có hiệu lực; hệ thống vẫn giữ căn cứ đang có hiệu lực tại thời điểm hỏi.`,
          ]),
        ),
      };
    }

    if (!["effective", "partially_effective"].includes(updatedDocument.status)) {
      return updateUnavailableResponse(
        userQuery,
        result,
        candidate,
        `${updatedDocument.number} có dấu hiệu ${description} ${document.number}, nhưng trạng thái hiệu lực chưa được xác minh đầy đủ.`,
      );
    }

    const refreshed = await answerQuestionFromAnchors(
      `${userQuery}\nĐã phát hiện ${updatedDocument.number} ${description} ${document.number}. Khi kết luận phải ưu tiên nội dung mới đang có hiệu lực và chỉ dùng văn bản cũ để đối chiếu lịch sử.`,
      [updatedDocument, document],
    );

    return {
      ...refreshed,
      candidates: uniqueCandidates([
        ...(refreshed.candidates ?? []),
        ...(result.candidates ?? []),
      ]),
      warnings: Array.from(
        new Set([
          ...result.warnings,
          ...refreshed.warnings,
          `Hệ thống tự phát hiện ${updatedDocument.number} ${description} ${document.number} và đã ưu tiên văn bản mới khi trả lời.`,
        ]),
      ),
      confidence: Math.min(refreshed.confidence, 0.92),
    };
  } catch {
    const issuedYear = Number(document.issued_date?.slice(0, 4));
    if (!issuedYear || issuedYear >= new Date().getFullYear()) return result;
    return {
      ...result,
      warnings: Array.from(
        new Set([
          ...result.warnings,
          `Chưa hoàn tất được lượt kiểm tra văn bản sửa đổi, thay thế mới hơn của ${document.number}; cần đối chiếu lại trước khi áp dụng cho hồ sơ thực tế.`,
        ]),
      ),
      confidence: Math.min(result.confidence, 0.64),
    };
  }
}

/**
 * `query` may include internal retrieval context. The safety gate always uses
 * the untouched user wording, either supplied explicitly or derived by
 * removing the internal context suffix.
 */
export async function searchTaxLawRobust(
  query: string,
  untouchedUserQuery?: string,
): Promise<TaxSearchResponse> {
  const hint = extractSearchHint(query);
  const userQuery = originalUserQuery(query, untouchedUserQuery);
  const verified = verifiedQuestionResponse(userQuery);
  if (verified) return verified;

  if (hint.asksQuestion) {
    const result = guardQuestionResult(userQuery, await searchTaxLaw(query));
    const current = await guardCurrentLawUpdate(userQuery, result);
    return ensureBinaryConclusion(userQuery, current);
  }
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

  if (hint.number) return noExactMatchResponse(query, hint, bestResult);
  return bestResult ?? searchTaxLaw(query);
}
