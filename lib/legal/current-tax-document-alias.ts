import { extractSearchHint, normalizeLegalQuery } from "./query.ts";
import { CURRENT_TAX_DOCUMENT_NUMBERS } from "./recent-tax-discovery-core.ts";

const LOOKUP_LANGUAGE = /\b(?:doc|mo|xem|tim|tra cuu|van ban|toan van)\b/u;

function documentType(number: string) {
  if (/\/(?:NĐ|ND)-CP$/iu.test(number)) return "Nghị định";
  if (/\/TT-/iu.test(number)) return "Thông tư";
  if (/\/NQ-/iu.test(number)) return "Nghị quyết";
  if (/\/(?:QĐ|QD)-/iu.test(number)) return "Quyết định";
  if (/\/(?:QH|UBTVQH)\d*$/iu.test(number)) return "Luật";
  return "Văn bản pháp luật";
}

function typeMatches(expected: string | null, number: string) {
  if (!expected) return true;
  return documentType(number) === expected;
}

function issuerMatches(normalized: string, number: string) {
  if (/\b(?:bo tai chinh|btc)\b/u.test(normalized)) return /\/TT-BTC$/iu.test(number);
  if (/\b(?:chinh phu|nd-cp)\b/u.test(normalized)) return /\/(?:NĐ|ND)-CP$/iu.test(number);
  return true;
}

/**
 * Chỉ suy ra số hiệu đầy đủ từ danh mục văn bản thuế hiện hành đã theo dõi.
 * Không đoán khi thiếu ý định tra cứu hoặc có hơn một ứng viên phù hợp.
 */
export function currentTaxDocumentCandidates(query: string) {
  const hint = extractSearchHint(query);
  const normalized = normalizeLegalQuery(query);
  if (!hint.number) return [];

  const hasLookupIntent = Boolean(hint.type) || LOOKUP_LANGUAGE.test(normalized);
  if (!hasLookupIntent) return [];

  return CURRENT_TAX_DOCUMENT_NUMBERS.filter((number) => {
    const [candidateNumber, candidateYear] = number.split("/");
    if (candidateNumber !== hint.number) return false;
    if (hint.year && candidateYear !== hint.year) return false;
    if (!typeMatches(hint.type, number)) return false;
    return issuerMatches(normalized, number);
  });
}

export function resolveCurrentTaxDocumentNumber(query: string) {
  const candidates = currentTaxDocumentCandidates(query);
  return candidates.length === 1 ? candidates[0] : null;
}
