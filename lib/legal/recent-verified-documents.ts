import { unstable_cache } from "next/cache";
import { hasUsableLegalDocumentText } from "./document-quality.ts";
import { extractFromFile, parseLegalHierarchy, slugifyDocument } from "./ingestion.ts";
import {
  findRecentDocumentByNumber,
  findRecentDocumentForQuery,
  type RecentDocumentDefinition,
  type RecentDocumentDownload,
} from "./recent-document-definitions.ts";
import type { DocumentDetail, SearchCandidate, TaxSearchResponse } from "./types.ts";

const MAX_SOURCE_BYTES = 18_000_000;

function normalizeIdentifier(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("vi");
}

async function fetchDownload(definition: RecentDocumentDefinition) {
  let lastError: Error | null = null;

  for (const download of definition.downloads) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 22_000);
    try {
      const response = await fetch(download.url, {
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "user-agent": "Mozilla/5.0 Chrome/131 Safari/537.36",
          accept: `${download.mimeType},*/*`,
          referer: download.referer,
        },
      });
      if (!response.ok) throw new Error(`Nguồn toàn văn trả lỗi ${response.status}.`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength < 2_000 || buffer.byteLength > MAX_SOURCE_BYTES) {
        throw new Error("Tệp toàn văn không hợp lệ hoặc vượt giới hạn xử lý.");
      }
      return { buffer, download };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Không tải được tệp toàn văn.");
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error("Không tải được tệp toàn văn.");
}

async function extractVerifiedDocument(definition: RecentDocumentDefinition) {
  const { buffer, download } = await fetchDownload(definition);
  const file = new File([new Uint8Array(buffer)], download.fileName, { type: download.mimeType });
  const extracted = await extractFromFile(file);
  const officialText = extracted.officialText.trim();

  if (extracted.requiresOcr) {
    throw new Error("Tệp PDF là bản scan và OCR chưa tạo được lớp chữ đạt yêu cầu.");
  }
  if (officialText.length < definition.minimumTextLength) {
    throw new Error("Tệp nguồn chưa chứa đủ nội dung chữ để hiển thị toàn văn.");
  }
  if (!hasUsableLegalDocumentText(officialText, definition.number)) {
    throw new Error("Nội dung trích xuất không khớp cấu trúc hoặc số hiệu văn bản cần tìm.");
  }

  return { extracted, officialText, download };
}

function buildDocument(
  definition: RecentDocumentDefinition,
  extracted: Awaited<ReturnType<typeof extractVerifiedDocument>>["extracted"],
  officialText: string,
  download: RecentDocumentDownload,
): DocumentDetail {
  const provisions = parseLegalHierarchy(officialText).map((provision, index) => ({
    id: `${slugifyDocument(definition.number)}-${index}`,
    type: provision.provisionType,
    identifier: provision.identifier,
    article: provision.article,
    heading: provision.heading,
    official_text: provision.officialText,
    order_index: provision.orderIndex,
  }));

  return {
    id: slugifyDocument(`${definition.number}-bo-tai-chinh`),
    number: definition.number,
    title: definition.title,
    type: "Thông tư",
    issuer: "Bộ Tài chính",
    issued_date: definition.issuedDate,
    effective_date: definition.effectiveDate,
    status: "effective",
    source_url: definition.officialPage,
    source_label: "Cổng Thông tin điện tử Chính phủ",
    last_verified_at: new Date().toISOString(),
    extraction_method: extracted.extractionMethod,
    quality_score: extracted.qualityScore,
    verification_notes:
      `${download.label}. Số hiệu, cơ quan ban hành, ngày ban hành, ngày hiệu lực và trích yếu được đối chiếu với trang công bố chính thức.`,
    official_text: officialText,
    provisions,
  };
}

const loadCachedRecentDocument = unstable_cache(
  async (number: string): Promise<DocumentDetail> => {
    const definition = findRecentDocumentByNumber(number);
    if (!definition) throw new Error("Văn bản chưa có trong danh sách đối chiếu gần đây.");
    const { extracted, officialText, download } = await extractVerifiedDocument(definition);
    return buildDocument(definition, extracted, officialText, download);
  },
  ["thue-ro-recent-verified-documents-v1"],
  { revalidate: 24 * 60 * 60 },
);

export function recentVerifiedCandidate(number: string): SearchCandidate | null {
  const definition = findRecentDocumentByNumber(number);
  if (!definition) return null;
  return {
    id: `recent-${slugifyDocument(definition.number)}`,
    number: definition.number,
    title: `Thông tư số ${definition.number}: ${definition.title}`,
    type: "Thông tư",
    issuer: "Bộ Tài chính",
    issued_date: definition.issuedDate,
    source_url: definition.officialPage,
    source_label: "Cổng Thông tin điện tử Chính phủ",
  };
}

export async function loadRecentVerifiedDocument(number: string) {
  const definition = findRecentDocumentByNumber(number);
  if (!definition) return null;
  return loadCachedRecentDocument(definition.number);
}

export async function recentVerifiedDocumentResponse(query: string): Promise<TaxSearchResponse | null> {
  const definition = findRecentDocumentForQuery(query);
  if (!definition) return null;

  try {
    const document = await loadCachedRecentDocument(definition.number);
    const mirrored = document.verification_notes?.includes("công bố lại") ?? false;
    return {
      query_normalized: normalizeIdentifier(definition.number),
      query_kind: "document",
      direct_answer: `Đã tìm thấy ${definition.number}.`,
      document,
      candidates: [],
      warnings: mirrored
        ? ["Lớp chữ được đọc từ bản công bố lại và đã đối chiếu các thuộc tính với trang công bố chính thức."]
        : [],
      confidence: mirrored ? 0.94 : 0.99,
      retrieved_at: new Date().toISOString(),
    };
  } catch (error) {
    const candidate = recentVerifiedCandidate(definition.number);
    return {
      query_normalized: normalizeIdentifier(definition.number),
      query_kind: "document",
      direct_answer:
        `Đã xác định ${definition.number} do Bộ Tài chính ban hành, nhưng tệp toàn văn hiện chưa tạo được lớp chữ đạt yêu cầu.`,
      document: null,
      candidates: candidate ? [candidate] : [],
      warnings: [error instanceof Error ? error.message : "Không tải được tệp toàn văn."],
      confidence: 0.92,
      retrieved_at: new Date().toISOString(),
    };
  }
}
