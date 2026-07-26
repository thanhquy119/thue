import { buildAnchoredEvidence } from "./anchored-evidence.ts";
import { answerFromOfficialEvidence, GeminiUnavailableError } from "./gemini";
import { normalizeLegalQuery } from "./query";
import {
  answerFromReviewedFormGuidance,
  requestedFormFieldNumbers,
  reviewedFormGuidanceCandidate,
  reviewedFormGuidanceForQuery,
} from "./reviewed-form-guidance.ts";
import type { AnchoredReference } from "./anchored-reference";
import type { DocumentDetail, SearchCandidate, TaxSearchResponse } from "./types";

export { buildAnchoredEvidence } from "./anchored-evidence.ts";
export { extractAnchoredReferences, isAnchoredLegalQuestion } from "./anchored-reference";

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
  const reviewedGuidance = reviewedFormGuidanceForQuery(query, documents);
  const requestedFields = requestedFormFieldNumbers(query);
  if (
    reviewedGuidance &&
    requestedFields.length > 0 &&
    requestedFields.every((field) => reviewedGuidance.fieldNumbers.includes(field))
  ) {
    return {
      query_normalized: normalizeLegalQuery(query),
      query_kind: "question",
      direct_answer: answerFromReviewedFormGuidance(reviewedGuidance, requestedFields),
      document: primary,
      candidates: primary
        ? documents.slice(1).map(candidateFromDocument)
        : [reviewedFormGuidanceCandidate(reviewedGuidance)],
      warnings: [
        `Phần hướng dẫn biểu mẫu được đối chiếu từ Mẫu ${reviewedGuidance.formNumber}, Phụ lục I Thông tư ${reviewedGuidance.documentNumber}. Tệp Word cũ không cung cấp đầy đủ lớp chữ của các ô và ghi chú biểu mẫu nên hệ thống dùng bản ghi đã được rà soát trực quan.`,
      ],
      confidence: 0.97,
      retrieved_at: retrievedAt,
    };
  }

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
