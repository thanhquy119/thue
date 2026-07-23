import type { SearchCandidate, TaxSearchResponse } from "./types.ts";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeGovernmentPortalShell(value: string) {
  const opening = value.slice(0, 12_000);
  const normalized = normalize(opening);
  const signals = [
    /\benglish\b/i.test(opening),
    opening.includes("中文"),
    normalized.includes("trang chu chinh phu"),
    normalized.includes("nuoc chxhcn viet nam"),
    normalized.includes("thu dien tu cong vu chinh phu"),
    normalized.includes("bao dien tu chinh phu"),
    normalized.includes("lai chau"),
    normalized.includes("dien bien"),
    normalized.includes("tuyen quang"),
  ].filter(Boolean).length;

  return signals >= 4;
}

export function hasUsableLegalDocumentText(value: string, expectedNumber?: string) {
  const text = value.trim();
  if (text.length < 800 || looksLikeGovernmentPortalShell(text)) return false;

  const normalized = normalize(text.slice(0, 20_000)).replace(/\s+/g, "");
  const expected = expectedNumber ? normalize(expectedNumber).replace(/\s+/g, "") : "";
  if (expected && !normalized.includes(expected)) return false;

  const legalMarkers = (text.match(/^\s*(?:Điều|Chương|Mục)\s+[0-9IVXLC]+/gimu) ?? []).length;
  return legalMarkers >= 2 || (text.length >= 5_000 && /\b(?:THÔNG TƯ|NGHỊ ĐỊNH|LUẬT|NGHỊ QUYẾT)\b/u.test(text));
}

function candidateFromDocument(result: TaxSearchResponse): SearchCandidate | null {
  const document = result.document;
  if (!document) return null;
  return {
    id: document.id,
    number: document.number,
    title: document.title,
    type: document.type,
    issuer: document.issuer,
    issued_date: document.issued_date,
    source_url: document.source_url,
    source_label: document.source_label,
  };
}

export function rejectPortalShellDocument(result: TaxSearchResponse): TaxSearchResponse {
  const document = result.document;
  if (!document || !looksLikeGovernmentPortalShell(document.official_text)) return result;

  const candidate = candidateFromDocument(result);
  const candidates = candidate
    ? [candidate, ...(result.candidates ?? []).filter((item) => item.number !== candidate.number)]
    : result.candidates ?? [];

  return {
    ...result,
    direct_answer:
      `Đã xác định đúng ${document.number}, nhưng nguồn chính thức hiện chỉ trả phần khung của trang Cổng Chính phủ ` +
      "thay vì toàn văn. Hệ thống đã chặn nội dung menu, thời tiết và chân trang để tránh hiển thị nhầm là văn bản pháp luật.",
    document: null,
    candidates,
    warnings: Array.from(
      new Set([
        ...result.warnings,
        "Nguồn toàn văn chưa có lớp chữ đạt yêu cầu; vui lòng mở liên kết nguồn hoặc thử lại sau.",
      ]),
    ),
    confidence: Math.min(result.confidence, 0.55),
  };
}
