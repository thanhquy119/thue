import { unstable_cache } from "next/cache";
import { answerFromOfficialEvidence, discoverOfficialSources, GeminiUnavailableError } from "./gemini";
import { extractFromUrl, parseLegalHierarchy, slugifyDocument } from "./ingestion";
import { extractSearchHint, lexicalRelevance, normalizeLegalQuery } from "./query";
import type {
  DocumentDetail,
  EffectiveStatus,
  OnlineLegalSource,
  SearchCandidate,
  SearchHint,
  TaxSearchResponse,
} from "./types";

const DOCUMENT_REVALIDATE_SECONDS = 7 * 24 * 60 * 60;

function normalizeNumber(value: string) {
  return normalizeLegalQuery(value).replace(/\s+/g, "");
}

function sourceScore(query: string, source: OnlineLegalSource) {
  const hint = extractSearchHint(query);
  const haystack = normalizeLegalQuery(
    `${source.document_number ?? ""} ${source.document_type ?? ""} ${source.title} ${source.snippet} ${source.url}`,
  );
  let score = source.score + lexicalRelevance(query, haystack);
  if (hint.number && new RegExp(`(?:^|[^0-9])${hint.number}(?:/|[^0-9]|$)`).test(haystack)) score += 2.5;
  if (hint.year && haystack.includes(hint.year)) score += 1.8;
  if (hint.type && haystack.includes(normalizeLegalQuery(hint.type))) score += 0.8;
  if (source.document_number && exactSourceMatch(source, hint)) score += 2.2;
  return score;
}

function exactSourceMatch(source: OnlineLegalSource, hint: SearchHint) {
  const numberText = normalizeLegalQuery(source.document_number || source.title);
  const typeText = normalizeLegalQuery(source.document_type || source.title);
  const numberMatches = !hint.number || new RegExp(`(?:^|[^0-9])${hint.number}(?:/|[^0-9]|$)`).test(numberText);
  const yearMatches = !hint.year || numberText.includes(hint.year);
  const typeMatches = !hint.type || typeText.includes(normalizeLegalQuery(hint.type));
  return numberMatches && yearMatches && typeMatches;
}

function sourceCandidate(source: OnlineLegalSource): SearchCandidate {
  const number = source.document_number?.trim() || source.title.match(/\b\d{1,4}\s*\/\s*20\d{2}\s*\/\s*[A-ZĐ0-9-]+/iu)?.[0] || source.title;
  return {
    id: source.id,
    number: number.replace(/\s+/g, ""),
    title: source.title,
    type: source.document_type || inferType(number, source.title),
    issuer: source.issuer || "Chưa xác định cơ quan ban hành",
    issued_date: source.issued_date || null,
    source_url: source.url,
    source_label: source.source_label,
  };
}

function documentCandidate(document: DocumentDetail): SearchCandidate {
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

function uniqueCandidates(candidates: SearchCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${normalizeNumber(candidate.number)}:${normalizeLegalQuery(candidate.issuer)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractDocumentNumber(title: string, text: string, query: string) {
  const sample = `${title}\n${text.slice(0, 8_000)}\n${query}`;
  const full = sample.match(
    /\b\d{1,4}\s*\/\s*20\d{2}\s*\/\s*(?:NĐ-CP|ND-CP|TT-[A-ZĐ0-9-]+|NQ-[A-ZĐ0-9-]+|QĐ-[A-ZĐ0-9-]+|QD-[A-Z0-9-]+|QH\d*|UBTVQH\d*)\b/iu,
  )?.[0];
  if (full) {
    return full
      .replace(/\s+/g, "")
      .replace(/ND-CP/iu, "NĐ-CP")
      .replace(/^QD-/iu, "QĐ-");
  }
  const hint = extractSearchHint(query);
  return hint.number ? `${hint.number}${hint.year ? `/${hint.year}` : ""}` : "Chưa xác định số hiệu";
}

function inferType(number: string, title: string) {
  const value = normalizeLegalQuery(`${number} ${title}`);
  if (value.includes("nghi dinh") || value.includes("nd-cp")) return "Nghị định";
  if (value.includes("thong tu") || /\btt-[a-z0-9-]+\b/.test(value)) return "Thông tư";
  if (value.includes("nghi quyet") || value.includes("nq-") || value.includes("nq ")) return "Nghị quyết";
  if (value.includes("quyet dinh") || value.includes("qd-")) return "Quyết định";
  if (value.includes("luat")) return "Luật";
  return "Văn bản pháp luật";
}

function inferIssuer(text: string) {
  const sample = text.slice(0, 12_000).toLocaleUpperCase("vi");
  if (sample.includes("ỦY BAN THƯỜNG VỤ QUỐC HỘI")) return "Ủy ban Thường vụ Quốc hội";
  if (sample.includes("QUỐC HỘI")) return "Quốc hội";
  if (sample.includes("BỘ TÀI CHÍNH")) return "Bộ Tài chính";
  if (sample.includes("TỔNG CỤC THUẾ")) return "Tổng cục Thuế";
  if (sample.includes("CỤC THUẾ")) return "Cục Thuế";
  if (sample.includes("THỦ TƯỚNG CHÍNH PHỦ")) return "Thủ tướng Chính phủ";
  if (sample.includes("CHÍNH PHỦ")) return "Chính phủ";
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
  return title || number;
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

function compactExcerpt(value: string, maxLength = 900) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, maxLength);
  const sentenceEnd = Math.max(shortened.lastIndexOf(". "), shortened.lastIndexOf("; "));
  return `${shortened.slice(0, sentenceEnd > 420 ? sentenceEnd + 1 : maxLength).trim()}…`;
}

function extractiveAnswer(query: string, documents: DocumentDetail[]) {
  const ranked = documents
    .flatMap((document) =>
      document.provisions.map((provision) => ({
        document,
        provision,
        score: lexicalRelevance(
          query,
          `${document.number} ${document.title} ${provision.identifier ?? ""} ${provision.heading ?? ""} ${provision.official_text}`,
        ),
      })),
    )
    .filter((item) => item.provision.official_text.trim().length > 80)
    .sort((left, right) => right.score - left.score || left.provision.order_index - right.provision.order_index);

  const selected: typeof ranked = [];
  const seen = new Set<string>();
  for (const item of ranked) {
    const key = `${item.document.number}:${item.provision.identifier ?? item.provision.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(item);
    if (selected.length >= 3) break;
  }

  if (!selected.length) {
    return "Đã tìm thấy văn bản có liên quan, nhưng chưa xác định được Điều/Khoản đủ gần với câu hỏi. Toàn văn của văn bản chính được hiển thị bên dưới để tiếp tục đối chiếu.";
  }

  return [
    "Hệ thống đã đối chiếu câu hỏi với văn bản chính thức. Các căn cứ gần nhất được trích nguyên ý dưới đây; cần đọc toàn bộ Điều/Khoản và tình trạng hiệu lực trước khi áp dụng vào hồ sơ cụ thể.",
    ...selected.map(({ document, provision }) =>
      `${document.number} — ${provision.identifier ?? "Nội dung liên quan"}${provision.heading ? ` — ${provision.heading}` : ""}\n${compactExcerpt(provision.official_text)}`,
    ),
  ].join("\n\n");
}

export async function searchTaxLaw(query: string): Promise<TaxSearchResponse> {
  const hint = extractSearchHint(query);
  const retrievedAt = new Date().toISOString();
  const discovery = await discoverOfficialSources(query);
  const rankedSources = [...discovery.sources].sort(
    (left, right) => sourceScore(query, right) - sourceScore(query, left),
  );

  const shorthandCandidates =
    hint.number && hint.type && !hint.year && !hint.asksQuestion
      ? uniqueCandidates(
          rankedSources
            .filter((source) => exactSourceMatch(source, hint))
            .map(sourceCandidate),
        ).slice(0, 10)
      : [];

  if (shorthandCandidates.length > 1) {
    const shorthandType = hint.type ?? "Văn bản";
    return {
      query_normalized: hint.normalized,
      query_kind: "document",
      direct_answer: `Có nhiều ${shorthandType.toLocaleLowerCase("vi")} mang số ${hint.number}. Chọn đúng năm, cơ quan ban hành hoặc trích yếu để mở toàn văn.`,
      document: null,
      candidates: shorthandCandidates,
      warnings: [],
      confidence: 0.92,
      retrieved_at: retrievedAt,
    };
  }

  const extracted: DocumentDetail[] = [];
  const warnings: string[] = [];
  const sourceLimit = hint.asksQuestion ? 10 : 7;
  for (const source of rankedSources.slice(0, sourceLimit)) {
    try {
      const document = await cachedDocumentFromSource(source.url, source.title, source.snippet, query);
      const exactNumberMatches = !hint.number || exactSourceMatch(
        { ...source, document_number: document.number, document_type: document.type },
        hint,
      );
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
      candidates: shorthandCandidates,
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
      answer = extractiveAnswer(query, extracted);
      confidence = 0.7;
      if (error instanceof GeminiUnavailableError) {
        warnings.push("Chế độ tổng hợp câu trả lời đang tạm giới hạn; phần trên là các căn cứ gần nhất được trích trực tiếp từ văn bản chính thức.");
      }
    }
  }

  const relatedCandidates = hint.asksQuestion
    ? uniqueCandidates(extracted.slice(1).map(documentCandidate)).slice(0, 5)
    : [];

  return {
    query_normalized: hint.normalized,
    query_kind: hint.asksQuestion ? "question" : "document",
    direct_answer: answer,
    document: primary,
    candidates: relatedCandidates,
    warnings: Array.from(new Set(warnings)).slice(0, 3),
    confidence,
    retrieved_at: retrievedAt,
  };
}
