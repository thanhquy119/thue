import { answerFromOfficialEvidence, GeminiUnavailableError, type OfficialEvidence } from "./gemini";
import { lexicalRelevance, normalizeLegalQuery } from "./query";
import type { DocumentDetail, SearchCandidate, TaxSearchResponse } from "./types";

export type AnchoredReference = {
  type: string;
  number: string;
  year: string;
  suffix: string | null;
  lookupQuery: string;
};

const TYPE_MAPPING: Record<string, string> = {
  nd: "Nghị định",
  "nghi dinh": "Nghị định",
  tt: "Thông tư",
  "thong tu": "Thông tư",
  nq: "Nghị quyết",
  "nghi quyet": "Nghị quyết",
  qd: "Quyết định",
  "quyet dinh": "Quyết định",
  luat: "Luật",
};

const ANCHORED_ACTION_PATTERN =
  /\b(?:phan tich|giai thich|tom tat|doi chieu|danh gia|ap dung|xu ly|huong dan|dua tren|can cu theo|theo quy dinh tai|van ban bo sung|noi dung bo sung|diem moi|noi dung sua doi)\b/;

function canonicalSuffix(type: string, rawSuffix: string | null, normalizedQuery: string) {
  const suffix = rawSuffix?.replace(/^[-/]+/, "").toLocaleLowerCase("en") ?? "";
  if (type === "Thông tư") {
    if (suffix === "btc" || suffix === "tt-btc" || normalizedQuery.includes("bo tai chinh")) return "TT-BTC";
    if (suffix.startsWith("tt-")) return suffix.toLocaleUpperCase("vi");
  }
  if (type === "Nghị định") return "NĐ-CP";
  if (type === "Nghị quyết" && suffix) return suffix.toLocaleUpperCase("vi");
  if (type === "Quyết định" && suffix) return suffix.toLocaleUpperCase("vi");
  if (type === "Luật" && /^qh\d*$/i.test(suffix)) return suffix.toLocaleUpperCase("vi");
  return suffix ? suffix.toLocaleUpperCase("vi") : null;
}

export function extractAnchoredReferences(query: string): AnchoredReference[] {
  const normalized = normalizeLegalQuery(query);
  const matches = [
    ...normalized.matchAll(
      /\b(nghi dinh|thong tu|nghi quyet|quyet dinh|luat|nd|tt|nq|qd)\s*(?:so\s*)?(\d{1,4})\s*[/-]\s*(20\d{2})(?:\s*[/-]\s*([a-z0-9-]+))?/g,
    ),
  ];
  const seen = new Set<string>();

  return matches.flatMap((match) => {
    const type = TYPE_MAPPING[match[1]];
    const number = match[2];
    const year = match[3];
    if (!type || !number || !year) return [];
    const suffix = canonicalSuffix(type, match[4] ?? null, normalized);
    const key = `${type}:${number}:${year}:${suffix ?? ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const identifier = `${number}/${year}${suffix ? `/${suffix}` : ""}`;
    return [{ type, number, year, suffix, lookupQuery: `${type} ${identifier}` }];
  });
}

export function isAnchoredLegalQuestion(query: string) {
  const normalized = normalizeLegalQuery(query);
  const references = extractAnchoredReferences(query);
  if (!references.length) return false;
  return (
    ANCHORED_ACTION_PATTERN.test(normalized) ||
    /\btheo\s+(?:thong tu|nghi dinh|nghi quyet|quyet dinh|luat|tt|nd|nq|qd)\b/.test(normalized)
  );
}

function normalizedIdentifier(value: string) {
  return normalizeLegalQuery(value).replace(/\s+/g, "");
}

export function referenceMatchesDocument(reference: AnchoredReference, document: DocumentDetail) {
  const identifier = normalizedIdentifier(document.number);
  const type = normalizeLegalQuery(document.type);
  return (
    new RegExp(`(?:^|[^0-9])${reference.number}(?:/|[^0-9]|$)`).test(identifier) &&
    identifier.includes(reference.year) &&
    type.includes(normalizeLegalQuery(reference.type))
  );
}

function analysisIntentBoost(query: string, value: string) {
  const normalizedQuery = normalizeLegalQuery(query);
  const normalizedValue = normalizeLegalQuery(value);
  let score = 0;
  if (/\b(?:bo sung|sua doi|diem moi|thay the|bai bo|van ban bo sung)\b/.test(normalizedQuery)) {
    if (/\b(?:bo sung|sua doi|thay the|bai bo|quy dinh chi tiet|huong dan thi hanh)\b/.test(normalizedValue)) {
      score += 2.4;
    }
  }
  if (/\b(?:phan tich|giai thich|tom tat|danh gia)\b/.test(normalizedQuery)) {
    if (/\b(?:pham vi dieu chinh|doi tuong ap dung|nguyen tac|trach nhiem|hieu luc thi hanh)\b/.test(normalizedValue)) {
      score += 0.9;
    }
  }
  return score;
}

function evidenceForAnchors(query: string, documents: DocumentDetail[]): OfficialEvidence[] {
  return documents.map((document) => {
    const ranked = document.provisions
      .map((provision) => ({
        provision,
        score:
          lexicalRelevance(
            query,
            `${provision.identifier ?? ""} ${provision.heading ?? ""} ${provision.official_text}`,
          ) +
          analysisIntentBoost(
            query,
            `${provision.identifier ?? ""} ${provision.heading ?? ""} ${provision.official_text}`,
          ),
      }))
      .filter(({ provision }) => provision.official_text.trim().length > 60)
      .sort((left, right) => right.score - left.score || left.provision.order_index - right.provision.order_index)
      .slice(0, 12)
      .map(({ provision }) =>
        `${provision.identifier ?? "Nội dung"}${provision.heading ? ` — ${provision.heading}` : ""}\n${provision.official_text.slice(0, 5_000)}`,
      );

    return {
      document_number: document.number,
      title: `[Văn bản người dùng chỉ định làm căn cứ chính] ${document.title}`,
      issued_date: document.issued_date,
      effective_date: document.effective_date,
      status: document.status,
      excerpts: ranked,
    };
  });
}

function compactExcerpt(value: string, maxLength = 1_000) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}…`;
}

function extractiveAnchoredAnswer(query: string, documents: DocumentDetail[]) {
  const selected = documents
    .flatMap((document) =>
      document.provisions.map((provision) => ({
        document,
        provision,
        score:
          lexicalRelevance(
            query,
            `${provision.identifier ?? ""} ${provision.heading ?? ""} ${provision.official_text}`,
          ) +
          analysisIntentBoost(
            query,
            `${provision.identifier ?? ""} ${provision.heading ?? ""} ${provision.official_text}`,
          ),
      })),
    )
    .filter(({ provision }) => provision.official_text.trim().length > 80)
    .sort((left, right) => right.score - left.score || left.provision.order_index - right.provision.order_index)
    .slice(0, 4);

  if (!selected.length) {
    return `Đã mở đúng ${documents.map((document) => document.number).join(", ")}, nhưng chưa xác định được Điều/Khoản đủ gần với yêu cầu. Toàn văn căn cứ chính được hiển thị bên dưới để tiếp tục đối chiếu.`;
  }

  return [
    `Phần dưới đây chỉ được trích từ ${documents.map((document) => document.number).join(", ")} — văn bản người dùng đã chỉ định làm căn cứ. Hệ thống không thay thế bằng các văn bản gần giống.`,
    ...selected.map(
      ({ document, provision }) =>
        `${document.number} — ${provision.identifier ?? "Nội dung liên quan"}${provision.heading ? ` — ${provision.heading}` : ""}\n${compactExcerpt(provision.official_text)}`,
    ),
  ].join("\n\n");
}

function candidateFromDocument(document: DocumentDetail): SearchCandidate {
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

export async function answerQuestionFromAnchors(
  query: string,
  documents: DocumentDetail[],
): Promise<TaxSearchResponse> {
  const retrievedAt = new Date().toISOString();
  const primary = documents[0] ?? null;
  if (!primary) {
    return {
      query_normalized: normalizeLegalQuery(query),
      query_kind: "question",
      direct_answer:
        "Câu hỏi có dẫn chiếu văn bản cụ thể nhưng hệ thống chưa mở được đúng văn bản đó. Hệ thống không dùng các văn bản gần giống để tránh nhầm căn cứ pháp lý.",
      document: null,
      candidates: [],
      warnings: [],
      confidence: 0.3,
      retrieved_at: retrievedAt,
    };
  }

  const warnings: string[] = [];
  let answer: string;
  let confidence = 0.9;
  try {
    const anchoredQuery = `Văn bản bắt buộc làm căn cứ chính: ${documents.map((document) => document.number).join(", ")}. Không thay thế bằng văn bản khác.\nYêu cầu của người dùng: ${query}`;
    answer = await answerFromOfficialEvidence(anchoredQuery, evidenceForAnchors(query, documents));
  } catch (error) {
    answer = extractiveAnchoredAnswer(query, documents);
    confidence = 0.76;
    if (error instanceof GeminiUnavailableError) {
      warnings.push(
        "Chế độ tổng hợp đang tạm giới hạn; phần trả lời được trích trực tiếp từ văn bản người dùng đã chỉ định.",
      );
    }
  }

  return {
    query_normalized: normalizeLegalQuery(query),
    query_kind: "question",
    direct_answer: answer,
    document: primary,
    candidates: documents.slice(1).map(candidateFromDocument),
    warnings,
    confidence,
    retrieved_at: retrievedAt,
  };
}
