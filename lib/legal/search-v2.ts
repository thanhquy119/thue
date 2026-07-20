import { unstable_cache } from "next/cache";
import { answerFromOfficialEvidence, GeminiUnavailableError } from "./gemini";
import { discoverOfficialSources } from "./discovery";
import { extractFromUrl, parseLegalHierarchy, slugifyDocument } from "./ingestion";
import { extractSearchHint, lexicalRelevance, normalizeLegalQuery } from "./query";
import type { DocumentDetail, EffectiveStatus, OnlineLegalSource, TaxSearchResponse } from "./types";

const DOCUMENT_REVALIDATE_SECONDS = 7 * 24 * 60 * 60;

function normalizeNumber(value: string) {
  return normalizeLegalQuery(value).replace(/\s+/g, "");
}

function sourceScore(query: string, source: OnlineLegalSource) {
  const hint = extractSearchHint(query);
  const haystack = normalizeLegalQuery(`${source.title} ${source.snippet} ${source.url}`);
  let score = source.score + lexicalRelevance(query, haystack);
  if (hint.number && new RegExp(`\\b${hint.number}\\b`).test(haystack)) score += 2.5;
  if (hint.year && haystack.includes(hint.year)) score += 1.8;
  if (hint.type && haystack.includes(normalizeLegalQuery(hint.type))) score += 0.8;
  if (haystack.includes("toan van") || haystack.includes("van ban")) score += 0.25;
  return score;
}

function extractDocumentNumber(title: string, text: string, query: string) {
  const sample = `${title}\n${text.slice(0, 8_000)}\n${query}`;
  const full = sample.match(
    /\b\d{1,4}\s*\/\s*20\d{2}\s*\/\s*(?:NĐ-CP|ND-CP|TT-BTC|NQ-CP|NQ-QH\d*|QH\d*|QĐ-TTg|QD-TTg|UBTVQH\d*)\b/iu,
  )?.[0];
  if (full) return full.replace(/\s+/g, "").replace(/ND-CP/iu, "NĐ-CP").replace(/QD-TTg/iu, "QĐ-TTg");
  const hint = extractSearchHint(query);
  return hint.number ? `${hint.number}${hint.year ? `/${hint.year}` : ""}` : "Chưa xác định số hiệu";
}

function inferType(number: string, title: string) {
  const value = normalizeLegalQuery(`${number} ${title}`);
  if (value.includes("nghi dinh") || value.includes("nd-cp")) return "Nghị định";
  if (value.includes("thong tu") || value.includes("tt-btc")) return "Thông tư";
  if (value.includes("nghi quyet") || value.includes("nq-") || value.includes("nq ")) return "Nghị quyết";
  if (value.includes("quyet dinh") || value.includes("qd-")) return "Quyết định";
  if (value.includes("luat")) return "Luật";
  return "Văn bản pháp luật";
}

function inferIssuer(text: string) {
  const sample = text.slice(0, 10_000).toLocaleUpperCase("vi");
  if (sample.includes("ỦY BAN THƯỜNG VỤ QUỐC HỘI")) return "Ủy ban Thường vụ Quốc hội";
  if (sample.includes("QUỐC HỘI")) return "Quốc hội";
  if (sample.includes("BỘ TÀI CHÍNH")) return "Bộ Tài chính";
  if (sample.includes("CHÍNH PHỦ")) return "Chính phủ";
  if (sample.includes("THỦ TƯỚNG CHÍNH PHỦ")) return "Thủ tướng Chính phủ";
  return "Đang đối chiếu";
}

function dateFromVietnamese(text: string, prefix: RegExp) {
  const match = text.match(prefix);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!day || !month || year < 1900) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function inferIssuedDate(text: string) {
  return dateFromVietnamese(text.slice(0, 12_000), /ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})/iu);
}

function inferEffectiveDate(text: string) {
  return dateFromVietnamese(
    text,
    /(?:có hiệu lực(?: thi hành)?|hiệu lực thi hành)\s+(?:kể từ|từ)?\s*ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})/iu,
  );
}

function inferStatus(effectiveDate: string | null): EffectiveStatus {
  if (!effectiveDate) return "unknown";
  return effectiveDate > new Date().toISOString().slice(0, 10) ? "upcoming" : "effective";
}

function cleanTitle(sourceTitle: string, number: string) {
  const title = sourceTitle
    .replace(/\s*[|·]\s*(?:Cổng|Bộ|Trang|Hệ thống|Cơ sở dữ liệu).*/iu, "")
    .replace(/^\s*(?:Toàn văn\s+)?/iu, "")
    .trim();
  if (!title) return number;
  return title;
}

const cachedDocumentFromSource = unstable_cache(
  async (url: string, title: string, snippet: string, query: string): Promise<DocumentDetail> => {
    const extracted = await extractFromUrl(url);
    if (extracted.requiresOcr) {
      throw new Error("Văn bản nguồn là PDF scan và hiện chưa có lớp chữ để hiển thị toàn văn.");
    }
    if (extracted.officialText.trim().length < 800) {
      throw new Error("Nguồn chính thức chưa cung cấp đủ nội dung chữ để hiển thị toàn văn.");
    }

    const number = extractDocumentNumber(title, extracted.officialText, query);
    const provisions = parseLegalHierarchy(extracted.officialText).map((provision, index) => ({
      id: `${slugifyDocument(number)}-${index}`,
      type: provision.provisionType,
      identifier: provision.identifier,
      article: provision.article,
      heading: provision.heading,
      official_text: provision.officialText,
      order_index: provision.orderIndex,
    }));
    const issuedDate = inferIssuedDate(extracted.officialText);
    const effectiveDate = inferEffectiveDate(extracted.officialText);

    return {
      id: slugifyDocument(`${number}-${url}`),
      number,
      title: cleanTitle(title, number),
      type: inferType(number, title),
      issuer: inferIssuer(extracted.officialText),
      issued_date: issuedDate,
      effective_date: effectiveDate,
      status: inferStatus(effectiveDate),
      source_url: extracted.sourceUrl || url,
      source_label: new URL(extracted.sourceUrl || url).hostname.replace(/^www\./, ""),
      last_verified_at: new Date().toISOString(),
      extraction_method: extracted.extractionMethod,
      quality_score: extracted.qualityScore,
      verification_notes: `Toàn văn được trích xuất từ ${extracted.fileName ?? "nguồn công bố chính thức"}.`,
      official_text: extracted.officialText,
      provisions,
    };
  },
  ["thue-ro-official-document-v4"],
  { revalidate: DOCUMENT_REVALIDATE_SECONDS, tags: ["official-legal-documents"] },
);

function evidenceForQuestion(query: string, documents: DocumentDetail[]) {
  return documents.map((document) => {
    const ranked = document.provisions
      .map((provision) => ({
        provision,
        score: lexicalRelevance(
          query,
          `${provision.identifier ?? ""} ${provision.heading ?? ""} ${provision.official_text}`,
        ),
      }))
      .sort((left, right) => right.score - left.score || left.provision.order_index - right.provision.order_index)
      .slice(0, 10)
      .map(({ provision }) =>
        `${provision.identifier ?? "Nội dung"}${provision.heading ? ` — ${provision.heading}` : ""}\n${provision.official_text.slice(0, 5_000)}`,
      );
    return { document_number: document.number, title: document.title, excerpts: ranked };
  });
}

export async function searchTaxLaw(query: string): Promise<TaxSearchResponse> {
  const hint = extractSearchHint(query);
  const retrievedAt = new Date().toISOString();
  const discovery = await discoverOfficialSources(query);
  const rankedSources = [...discovery.sources].sort(
    (left, right) => sourceScore(query, right) - sourceScore(query, left),
  );

  const extracted: DocumentDetail[] = [];
  const warnings: string[] = [];
  for (const source of rankedSources.slice(0, 8)) {
    try {
      const document = await cachedDocumentFromSource(source.url, source.title, source.snippet, query);
      const exactNumberMatches =
        !hint.number || normalizeNumber(document.number).includes(normalizeNumber(`${hint.number}${hint.year ? `/${hint.year}` : ""}`));
      if (exactNumberMatches || hint.asksQuestion) extracted.push(document);
      if (extracted.length >= (hint.asksQuestion ? 3 : 1)) break;
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "Không đọc được một nguồn chính thức.");
    }
  }

  const primary = extracted[0] ?? null;
  if (!primary) {
    return {
      query_normalized: hint.normalized,
      query_kind: hint.asksQuestion ? "question" : "document",
      direct_answer: "Đã tìm thấy nguồn tham khảo nhưng chưa thể trích xuất toàn văn dạng chữ từ nguồn chính thức.",
      document: null,
      warnings: Array.from(new Set(warnings)).slice(0, 3),
      confidence: 0.35,
      retrieved_at: retrievedAt,
    };
  }

  let answer = `Đã tìm thấy ${primary.number}: ${primary.title}.`;
  let confidence = hint.number ? 0.9 : 0.78;
  if (hint.asksQuestion) {
    try {
      answer = await answerFromOfficialEvidence(query, evidenceForQuestion(query, extracted));
      confidence = 0.84;
    } catch (error) {
      if (error instanceof GeminiUnavailableError) warnings.push(error.message);
      answer = discovery.draft_answer || "Đã tìm thấy văn bản chính liên quan và hiển thị toàn văn bên dưới.";
      confidence = 0.65;
    }
  }

  return {
    query_normalized: hint.normalized,
    query_kind: hint.asksQuestion ? "question" : "document",
    direct_answer: answer,
    document: primary,
    warnings: Array.from(new Set(warnings)).slice(0, 3),
    confidence,
    retrieved_at: retrievedAt,
  };
}
