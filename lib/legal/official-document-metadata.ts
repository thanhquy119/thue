import type { DocumentDetail, EffectiveStatus } from "./types.ts";

export type OfficialDocumentMetadata = {
  title: string | null;
  issuedDate: string | null;
  effectiveDate: string | null;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

export function parseOfficialDate(value: string) {
  const iso = value.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/u);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (validDateParts(year, month, day)) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const numeric = value.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](20\d{2})\b/u);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const year = Number(numeric[3]);
    if (validDateParts(year, month, day)) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const vietnamese = value.match(
    /\bngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(20\d{2})\b/iu,
  );
  if (vietnamese) {
    const day = Number(vietnamese[1]);
    const month = Number(vietnamese[2]);
    const year = Number(vietnamese[3]);
    if (validDateParts(year, month, day)) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

function validDateParts(year: number, month: number, day: number) {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function labeledDate(text: string, labels: RegExp) {
  const match = text.match(
    new RegExp(`${labels.source}\\s*(?::|-)??\\s*([^|;•]{0,90})`, labels.flags),
  );
  return match ? parseOfficialDate(match[1] ?? "") : null;
}

function cleanTitle(value: string) {
  return normalizeWhitespace(
    value
      .replace(/^(?:Trích yếu|Tiêu đề)\s*(?::|-)\s*/iu, "")
      .replace(/\s+(?:Ngày ban hành|Ngày có hiệu lực|Ngày hiệu lực|Tài liệu đính kèm).*$/iu, ""),
  );
}

function informativeTitle(value: string, number?: string) {
  const title = cleanTitle(value);
  if (title.length < 18 || title.length > 600) return false;
  if (/^(?:Văn bản|Toàn văn)\s+(?:số\s+)?/iu.test(title)) return false;
  const withoutNumber = number ? title.replace(number, "") : title;
  const letters = withoutNumber.match(/[A-Za-zÀ-ỹĐđ]/gu)?.length ?? 0;
  const words = withoutNumber.match(/[A-Za-zÀ-ỹĐđ]{2,}/gu)?.length ?? 0;
  return letters >= 12 && words >= 4;
}

export function extractOfficialMetadataFromText(
  rawText: string,
  expectedNumber?: string,
): OfficialDocumentMetadata {
  const text = normalizeWhitespace(rawText);
  const issuedDate = labeledDate(text, /(?:Ngày ban hành|Ban hành)/iu);
  const labeledEffectiveDate = labeledDate(
    text,
    /(?:Ngày có hiệu lực|Ngày hiệu lực|Hiệu lực)/iu,
  );

  let title: string | null = null;
  const titleMatch = text.match(
    /(?:Trích yếu|Tiêu đề)\s*(?::|-)\s*([\s\S]{18,600}?)(?=\s+(?:Ngày ban hành|Ngày có hiệu lực|Ngày hiệu lực|Tài liệu đính kèm|Người ký|Cơ quan ban hành)\b|$)/iu,
  );
  if (titleMatch && informativeTitle(titleMatch[1] ?? "", expectedNumber)) {
    title = cleanTitle(titleMatch[1] ?? "");
  }

  return {
    title,
    issuedDate,
    effectiveDate: labeledEffectiveDate,
  };
}

function ownEffectivityClause(text: string) {
  const normalized = normalizeWhitespace(text);
  const patterns = [
    /(?:Nghị định|Thông tư|Luật|Nghị quyết|Quyết định|Văn bản)\s+này\s+có\s+hiệu\s+lực(?:\s+thi\s+hành)?(?:\s+kể)?\s+từ\s+(ngày\s+\d{1,2}\s+tháng\s+\d{1,2}\s+năm\s+20\d{2}|\d{1,2}[/.\-]\d{1,2}[/.\-]20\d{2})/iu,
    /(?:Nghị định|Thông tư|Luật|Nghị quyết|Quyết định|Văn bản)\s+này\s+có\s+hiệu\s+lực(?:\s+thi\s+hành)?\s+kể\s+từ\s+ngày\s+ký/iu,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return match;
  }

  const tail = normalized.slice(Math.floor(normalized.length * 0.68));
  return tail.match(
    /\bcó\s+hiệu\s+lực(?:\s+thi\s+hành)?(?:\s+kể)?\s+từ\s+(ngày\s+\d{1,2}\s+tháng\s+\d{1,2}\s+năm\s+20\d{2}|\d{1,2}[/.\-]\d{1,2}[/.\-]20\d{2})/iu,
  );
}

export function inferEffectiveDateFromLegalText(
  text: string,
  issuedDate: string | null,
) {
  const clause = ownEffectivityClause(text);
  if (!clause) return null;
  if (/kể\s+từ\s+ngày\s+ký/iu.test(clause[0])) return issuedDate;
  return parseOfficialDate(clause[1] ?? clause[0]);
}

function officialSourceScore(document: DocumentDetail) {
  const value = `${document.source_url} ${document.source_label}`.toLocaleLowerCase("vi");
  let score = 0;
  if (value.includes("congbao.chinhphu.vn/van-ban/")) score += 10;
  else if (value.includes("vanban.chinhphu.vn")) score += 8;
  else if (value.includes("chinhphu.vn")) score += 5;
  if (/công báo|chính phủ|bộ tài chính/iu.test(document.source_label)) score += 3;
  if (document.effective_date) score += 2;
  if (document.issued_date) score += 1;
  return score;
}

function titleScore(document: DocumentDetail) {
  if (!informativeTitle(document.title, document.number)) return -100;
  let score = officialSourceScore(document);
  if (/\b(?:quy định|hướng dẫn|sửa đổi|bổ sung|thay thế|quản lý thuế|thuế)\b/iu.test(document.title)) {
    score += 5;
  }
  if (document.title.length >= 35 && document.title.length <= 360) score += 2;
  return score;
}

function validStoredDate(value: string | null) {
  return value ? parseOfficialDate(value) : null;
}

function statusFromEffectiveDate(
  effectiveDate: string | null,
  existing: EffectiveStatus,
): EffectiveStatus {
  if (["expired", "repealed", "partially_effective"].includes(existing)) return existing;
  if (!effectiveDate) return "unknown";
  return effectiveDate > new Date().toISOString().slice(0, 10) ? "upcoming" : "effective";
}

function bestDocumentWith<T>(
  documents: DocumentDetail[],
  getter: (document: DocumentDetail) => T | null,
) {
  return documents
    .filter((document) => getter(document) !== null)
    .sort((left, right) => officialSourceScore(right) - officialSourceScore(left))[0] ?? null;
}

export function mergeOfficialDocumentMetadata(
  contentDocument: DocumentDetail,
  metadataCandidates: DocumentDetail[],
): DocumentDetail {
  const documents = Array.from(new Set([contentDocument, ...metadataCandidates]));
  const issuedSource = bestDocumentWith(documents, (document) => validStoredDate(document.issued_date));
  const effectiveSource = bestDocumentWith(documents, (document) => validStoredDate(document.effective_date));
  const titleSource = [...documents].sort((left, right) => titleScore(right) - titleScore(left))[0] ?? contentDocument;
  const officialSource = [...documents].sort(
    (left, right) => officialSourceScore(right) - officialSourceScore(left),
  )[0] ?? contentDocument;

  const issuedDate = validStoredDate(issuedSource?.issued_date ?? null) ??
    extractOfficialMetadataFromText(contentDocument.official_text, contentDocument.number).issuedDate ??
    contentDocument.issued_date;
  const effectiveDate = validStoredDate(effectiveSource?.effective_date ?? null) ??
    inferEffectiveDateFromLegalText(contentDocument.official_text, issuedDate) ??
    null;
  const title = titleScore(titleSource) > -100 ? cleanTitle(titleSource.title) : contentDocument.title;
  const preservedStatus = documents.find((document) =>
    ["expired", "repealed", "partially_effective"].includes(document.status)
  )?.status ?? contentDocument.status;

  return {
    ...contentDocument,
    title,
    issuer: officialSource.issuer || contentDocument.issuer,
    issued_date: issuedDate,
    effective_date: effectiveDate,
    status: statusFromEffectiveDate(effectiveDate, preservedStatus),
    source_url: officialSource.source_url || contentDocument.source_url,
    source_label: officialSource.source_label || contentDocument.source_label,
    verification_notes: [
      contentDocument.verification_notes,
      effectiveDate && !contentDocument.effective_date
        ? "Ngày hiệu lực được hợp nhất từ metadata nguồn chính thức hoặc điều khoản thi hành đã xác minh."
        : null,
    ].filter(Boolean).join(" ") || null,
  };
}
