import { answerFromOfficialEvidence, GeminiUnavailableError, type OfficialEvidence } from "./gemini";
import { lexicalRelevance, normalizeLegalQuery } from "./query";
import type { AnchoredReference } from "./anchored-reference";
import type { DocumentDetail, ProvisionDetail, SearchCandidate, TaxSearchResponse } from "./types";

export { extractAnchoredReferences, isAnchoredLegalQuestion } from "./anchored-reference";

const MAX_SEGMENT_CHARACTERS = 3_600;
const SEGMENT_OVERLAP_LINES = 4;
const MAX_EVIDENCE_EXCERPTS_PER_DOCUMENT = 12;

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

function evidenceRetrievalQuery(query: string) {
  return normalizeLegalQuery(query)
    .replace(
      /\b(?:nghi dinh|thong tu|nghi quyet|quyet dinh|luat|nd|tt|nq|qd)\s*(?:so\s*)?\d{1,4}(?:\s*[/-]\s*20\d{2})?(?:\s*[/-]\s*(?:nd-cp|tt-[a-z0-9-]+|nq-[a-z0-9-]+|qd-[a-z0-9-]+|qh\d*|ubtvqh\d*))?/g,
      " ",
    )
    .replace(
      /\b\d{1,4}\s*[/-]\s*20\d{2}(?:\s*[/-]\s*(?:nd-cp|tt-[a-z0-9-]+|nq-[a-z0-9-]+|qd-[a-z0-9-]+|qh\d*|ubtvqh\d*))?\b/g,
      " ",
    )
    .replace(/\b(?:theo|can cu|dua tren|van ban|duoc chi dinh lam can cu chinh)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function requestedFieldNumbers(query: string) {
  return Array.from(
    new Set(
      (evidenceRetrievalQuery(query).match(/\b\d{1,3}\b/g) ?? [])
        .map(Number)
        .filter((value) => Number.isInteger(value) && value > 0 && value < 1_000),
    ),
  ).slice(0, 12);
}

function splitLongLine(line: string) {
  if (line.length <= MAX_SEGMENT_CHARACTERS) return [line];
  const chunks: string[] = [];
  const overlap = 500;
  for (let start = 0; start < line.length; start += MAX_SEGMENT_CHARACTERS - overlap) {
    chunks.push(line.slice(start, start + MAX_SEGMENT_CHARACTERS));
    if (start + MAX_SEGMENT_CHARACTERS >= line.length) break;
  }
  return chunks;
}

function splitProvisionText(value: string) {
  const text = value.trim();
  if (!text) return [];
  if (text.length <= MAX_SEGMENT_CHARACTERS) return [text];

  const lines = text
    .split(/\n+/)
    .flatMap((line) => splitLongLine(line.trim()))
    .filter(Boolean);
  const chunks: string[] = [];
  let start = 0;

  while (start < lines.length) {
    let end = start;
    let characters = 0;
    while (end < lines.length) {
      const nextLength = lines[end].length + (end > start ? 1 : 0);
      if (end > start && characters + nextLength > MAX_SEGMENT_CHARACTERS) break;
      characters += nextLength;
      end += 1;
    }
    chunks.push(lines.slice(start, end).join("\n"));
    if (end >= lines.length) break;
    start = Math.max(start + 1, end - SEGMENT_OVERLAP_LINES);
  }

  return chunks;
}

function exactFieldHitCount(text: string, numbers: number[]) {
  return numbers.reduce((count, number) => {
    const pattern = new RegExp(
      `(?:\\[\\s*${number}\\s*\\]|\\bchỉ\\s*tiêu\\s*\\[?\\s*${number}\\s*\\]?\\b|(?:^|\\n|\\|)\\s*${number}\\s*(?:\\||[.)]|$))`,
      "iu",
    );
    return count + (pattern.test(text) ? 1 : 0);
  }, 0);
}

function formIntentBoost(query: string, text: string) {
  const normalizedQuery = evidenceRetrievalQuery(query);
  if (!/\b(?:chi tieu|to khai|mau|bieu mau|khau tru|ke khai)\b/.test(normalizedQuery)) return 0;
  const normalizedText = normalizeLegalQuery(text);
  let score = 0;
  if (/\b(?:chi tieu|to khai|mau so|bieu mau|khau tru|ke khai)\b/.test(normalizedText)) score += 1.1;
  if (/\[\s*\d{1,3}\s*\]|(?:^|\n|\|)\s*\d{1,3}\s*\|/u.test(text)) score += 0.9;
  return score;
}

type EvidenceSegment = {
  provision: ProvisionDetail;
  text: string;
  chunkIndex: number;
  chunkCount: number;
  score: number;
  exactFieldHits: number;
};

function evidenceSegments(query: string, document: DocumentDetail) {
  const retrievalQuery = evidenceRetrievalQuery(query) || query;
  const fieldNumbers = requestedFieldNumbers(query);
  return document.provisions.flatMap((provision) => {
    const chunks = splitProvisionText(provision.official_text);
    return chunks.map((text, chunkIndex): EvidenceSegment => {
      const labelledText = `${provision.identifier ?? ""} ${provision.heading ?? ""} ${text}`;
      const exactFieldHits = exactFieldHitCount(text, fieldNumbers);
      const score =
        lexicalRelevance(retrievalQuery, labelledText) +
        analysisIntentBoost(retrievalQuery, labelledText) +
        formIntentBoost(retrievalQuery, text) +
        exactFieldHits * 3;
      return {
        provision,
        text,
        chunkIndex,
        chunkCount: chunks.length,
        score,
        exactFieldHits,
      };
    });
  });
}

function segmentKey(segment: EvidenceSegment) {
  return `${segment.provision.id}:${segment.chunkIndex}`;
}

function rankedEvidenceSegments(query: string, document: DocumentDetail) {
  const segments = evidenceSegments(query, document);
  const byProvision = new Map<string, EvidenceSegment[]>();
  for (const segment of segments) {
    const siblings = byProvision.get(segment.provision.id) ?? [];
    siblings.push(segment);
    byProvision.set(segment.provision.id, siblings);
  }

  const ranked = [...segments].sort(
    (left, right) =>
      right.exactFieldHits - left.exactFieldHits ||
      right.score - left.score ||
      left.provision.order_index - right.provision.order_index ||
      left.chunkIndex - right.chunkIndex,
  );
  const selected = new Map<string, EvidenceSegment>();

  for (const seed of ranked.filter((segment) => segment.exactFieldHits > 0).slice(0, 5)) {
    selected.set(segmentKey(seed), seed);
    const siblings = byProvision.get(seed.provision.id) ?? [];
    for (const neighbourIndex of [seed.chunkIndex - 1, seed.chunkIndex + 1]) {
      const neighbour = siblings.find((segment) => segment.chunkIndex === neighbourIndex);
      if (neighbour) selected.set(segmentKey(neighbour), neighbour);
    }
  }

  for (const segment of ranked) {
    if (selected.size >= MAX_EVIDENCE_EXCERPTS_PER_DOCUMENT) break;
    selected.set(segmentKey(segment), segment);
  }

  return [...selected.values()]
    .sort(
      (left, right) =>
        right.exactFieldHits - left.exactFieldHits ||
        right.score - left.score ||
        left.provision.order_index - right.provision.order_index ||
        left.chunkIndex - right.chunkIndex,
    )
    .slice(0, MAX_EVIDENCE_EXCERPTS_PER_DOCUMENT);
}

function formatEvidenceSegment(segment: EvidenceSegment) {
  const base = `${segment.provision.identifier ?? "Nội dung"}${segment.provision.heading ? ` — ${segment.provision.heading}` : ""}`;
  const position = segment.chunkCount > 1 ? ` — đoạn ${segment.chunkIndex + 1}/${segment.chunkCount}` : "";
  return `${base}${position}\n${segment.text}`;
}

export function buildAnchoredEvidence(query: string, documents: DocumentDetail[]): OfficialEvidence[] {
  return documents.map((document) => ({
    document_number: document.number,
    title: `[Văn bản người dùng chỉ định làm căn cứ chính] ${document.title}`,
    issued_date: document.issued_date,
    effective_date: document.effective_date,
    status: document.status,
    excerpts: rankedEvidenceSegments(query, document).map(formatEvidenceSegment),
  }));
}

function compactExcerpt(value: string, maxLength = 1_200) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}…`;
}

function extractiveAnchoredAnswer(query: string, documents: DocumentDetail[]) {
  const selected = buildAnchoredEvidence(query, documents)
    .flatMap((evidence) =>
      evidence.excerpts.map((excerpt) => ({
        documentNumber: evidence.document_number,
        excerpt,
      })),
    )
    .slice(0, 6);

  if (!selected.length) {
    return `Đã mở đúng ${documents.map((document) => document.number).join(", ")}, nhưng chưa xác định được Điều/Khoản đủ gần với yêu cầu. Toàn văn căn cứ chính được hiển thị bên dưới để tiếp tục đối chiếu.`;
  }

  return [
    `Phần dưới đây chỉ được trích từ ${documents.map((document) => document.number).join(", ")} — văn bản người dùng đã chỉ định làm căn cứ. Hệ thống không thay thế bằng các văn bản gần giống.`,
    ...selected.map(({ documentNumber, excerpt }) => `${documentNumber}\n${compactExcerpt(excerpt)}`),
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
    answer = await answerFromOfficialEvidence(anchoredQuery, buildAnchoredEvidence(query, documents));
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
