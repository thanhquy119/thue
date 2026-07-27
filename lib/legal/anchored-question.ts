import { buildAnchoredEvidence } from "./anchored-evidence.ts";
import {
  blockedCurrentLawResponse,
  currentLawDocuments,
  requiresCurrentEffectiveLaw,
} from "./current-law-safety.ts";
import { answerFromOfficialEvidence, GeminiUnavailableError } from "./gemini.ts";
import { normalizeLegalQuery } from "./query.ts";
import {
  answerFromReviewedFormGuidance,
  requestedFormFieldNumbers,
  reviewedFormGuidanceCandidate,
  reviewedFormGuidanceForQuery,
} from "./reviewed-form-guidance.ts";
import type { AnchoredReference } from "./anchored-reference.ts";
import type { DocumentDetail, SearchCandidate, TaxSearchResponse } from "./types.ts";

export { buildAnchoredEvidence } from "./anchored-evidence.ts";
export { extractAnchoredReferences, isAnchoredLegalQuestion } from "./anchored-reference.ts";

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
  const currentSelection = currentLawDocuments(query, documents);
  const usableDocuments = requiresCurrentEffectiveLaw(query)
    ? currentSelection.eligible
    : documents;
  const primary = usableDocuments[0] ?? null;

  if (requiresCurrentEffectiveLaw(query) && documents.length > 0 && !primary) {
    const rejected = documents[0];
    return blockedCurrentLawResponse(
      query,
      {
        query_normalized: normalizeLegalQuery(query),
        query_kind: "question",
        direct_answer: "",
        document: rejected,
        candidates: [],
        warnings: [],
        confidence: 0.3,
        retrieved_at: retrievedAt,
      },
      rejected,
      ["Câu hỏi nghiệp vụ hiện hành chỉ dùng văn bản đã xác minh đang có hiệu lực hoặc còn hiệu lực một phần."],
    );
  }

  const reviewedGuidance = reviewedFormGuidanceForQuery(query, usableDocuments);
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
        ? usableDocuments.slice(1).map(candidateFromDocument)
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
  if (currentSelection.excluded.length > 0 && requiresCurrentEffectiveLaw(query)) {
    warnings.push(
      `Đã loại ${currentSelection.excluded.length} văn bản chưa đủ điều kiện hiệu lực khỏi căn cứ trả lời nghiệp vụ hiện hành.`,
    );
  }
  for (const document of usableDocuments) {
    if (document.status === "partially_effective") {
      warnings.push(`${document.number} chỉ còn hiệu lực một phần; cần đối chiếu đúng Điều/Khoản còn hiệu lực.`);
    }
  }

  let answer: string;
  let confidence = 0.9;
  try {
    const anchoredQuery = `Văn bản bắt buộc làm căn cứ chính: ${usableDocuments.map((document) => document.number).join(", ")}. Không thay thế bằng văn bản khác.\nYêu cầu của người dùng: ${query}`;
    answer = await answerFromOfficialEvidence(anchoredQuery, buildAnchoredEvidence(query, usableDocuments));
  } catch (error) {
    answer = extractiveAnchoredAnswer(query, usableDocuments);
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
    candidates: usableDocuments.slice(1).map(candidateFromDocument),
    warnings: Array.from(new Set(warnings)),
    confidence,
    retrieved_at: retrievedAt,
  };
}
