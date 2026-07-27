import { normalizeLegalQuery } from "./query.ts";
import type { DocumentDetail, EffectiveStatus, TaxSearchResponse } from "./types.ts";

export type LegalTimeIntent = "current" | "historical" | "future" | "relationship";

export type CurrentLawDecision = {
  allowed: boolean;
  intent: LegalTimeIntent;
  reason: "eligible" | "unknown" | "upcoming" | "expired" | "repealed";
  warning: string | null;
};

const INTERNAL_CONTEXT_MARKER = /\s+Ngữ cảnh tra cứu pháp lý:/iu;
const RELATIONSHIP_PATTERN =
  /\b(?:con hieu luc|het hieu luc|hieu luc den|hieu luc tu|sua doi|bo sung|thay the|bai bo|van ban nao thay|quan he phap ly)\b/u;
const HISTORICAL_PATTERN =
  /\b(?:tai thoi diem|vao thoi diem|trong giai doan|truoc ngay|truoc khi|truoc day|quy dinh cu|lich su|da ap dung|luc do|khi do|hoi nam|vao nam|trong nam)\b/u;
const FUTURE_PATTERN =
  /\b(?:sap toi|tuong lai|khi co hieu luc|sau ngay|ke tu ngay|ap dung tu)\b/u;

function userFacingQuery(query: string) {
  return query.split(INTERNAL_CONTEXT_MARKER)[0]?.trim() || query.trim();
}

function explicitYears(query: string) {
  return normalizeLegalQuery(userFacingQuery(query)).match(/\b20\d{2}\b/gu) ?? [];
}

export function legalTimeIntent(query: string, currentYear = new Date().getFullYear()): LegalTimeIntent {
  const normalized = normalizeLegalQuery(userFacingQuery(query));
  if (RELATIONSHIP_PATTERN.test(normalized)) return "relationship";
  if (HISTORICAL_PATTERN.test(normalized)) return "historical";

  const years = explicitYears(query).map(Number).filter(Number.isFinite);
  if (FUTURE_PATTERN.test(normalized) || years.some((year) => year > currentYear)) return "future";
  return "current";
}

export function requiresCurrentEffectiveLaw(query: string) {
  return legalTimeIntent(query) === "current";
}

function statusReason(status: EffectiveStatus): CurrentLawDecision["reason"] {
  if (status === "upcoming") return "upcoming";
  if (status === "expired") return "expired";
  if (status === "repealed") return "repealed";
  if (status === "unknown") return "unknown";
  return "eligible";
}

function warningFor(document: DocumentDetail, reason: CurrentLawDecision["reason"]) {
  if (reason === "unknown") {
    return `Chưa xác minh được trạng thái hiệu lực hiện tại của ${document.number}; văn bản này không được dùng làm căn cứ cho nghiệp vụ hiện hành.`;
  }
  if (reason === "upcoming") {
    return `${document.number} chưa có hiệu lực tại thời điểm hiện tại.`;
  }
  if (reason === "expired") {
    return `${document.number} đã hết hiệu lực và không được dùng làm căn cứ cho nghiệp vụ hiện hành.`;
  }
  if (reason === "repealed") {
    return `${document.number} đã bị bãi bỏ và không được dùng làm căn cứ cho nghiệp vụ hiện hành.`;
  }
  if (document.status === "partially_effective") {
    return `${document.number} chỉ còn hiệu lực một phần; phải đối chiếu đúng Điều/Khoản còn hiệu lực.`;
  }
  return null;
}

export function currentLawDecision(query: string, document: DocumentDetail): CurrentLawDecision {
  const intent = legalTimeIntent(query);
  const reason = statusReason(document.status);

  if (intent === "historical" || intent === "relationship") {
    return { allowed: true, intent, reason, warning: warningFor(document, reason) };
  }

  if (intent === "future") {
    const allowed = ["upcoming", "effective", "partially_effective"].includes(document.status);
    return { allowed, intent, reason, warning: warningFor(document, reason) };
  }

  const allowed = ["effective", "partially_effective"].includes(document.status);
  return { allowed, intent, reason, warning: warningFor(document, reason) };
}

export function currentLawDocuments(query: string, documents: DocumentDetail[]) {
  const eligible: DocumentDetail[] = [];
  const excluded: Array<{ document: DocumentDetail; decision: CurrentLawDecision }> = [];
  const warnings: string[] = [];

  for (const document of documents) {
    const decision = currentLawDecision(query, document);
    if (decision.allowed) eligible.push(document);
    else excluded.push({ document, decision });
    if (decision.warning) warnings.push(decision.warning);
  }

  return {
    eligible,
    excluded,
    warnings: Array.from(new Set(warnings)),
  };
}

export function blockedCurrentLawResponse(
  query: string,
  result: TaxSearchResponse,
  document: DocumentDetail,
  extraWarnings: string[] = [],
): TaxSearchResponse {
  const decision = currentLawDecision(query, document);
  const message = decision.reason === "unknown"
    ? `Hệ thống tìm thấy ${document.number}, nhưng chưa xác minh được văn bản này còn hiệu lực tại thời điểm hiện tại. Vì vậy nội dung của văn bản không được dùng để hướng dẫn nghiệp vụ và không được hiển thị như căn cứ chính.`
    : decision.reason === "upcoming"
      ? `Hệ thống tìm thấy ${document.number}, nhưng văn bản chưa có hiệu lực tại thời điểm hiện tại nên không được dùng để hướng dẫn nghiệp vụ đang áp dụng.`
      : `Hệ thống tìm thấy ${document.number}, nhưng văn bản không còn đủ điều kiện làm căn cứ cho nghiệp vụ hiện hành.`;

  return {
    ...result,
    direct_answer: `${message} Hệ thống chỉ trả lời khi tìm được văn bản đang có hiệu lực hoặc còn hiệu lực một phần và xác định được đúng Điều/Khoản áp dụng.`,
    document: null,
    candidates: [],
    warnings: Array.from(
      new Set([
        ...result.warnings,
        ...(decision.warning ? [decision.warning] : []),
        ...extraWarnings,
      ]),
    ).slice(0, 5),
    confidence: Math.min(result.confidence, 0.38),
  };
}
