import { looksLikeGovernmentPortalShell } from "./document-quality.ts";

export type DurableIngestionStatus = "processing" | "ready" | "needs_review" | "failed";

export type DurableIngestionStage =
  | "queued"
  | "downloading"
  | "extracting"
  | "ocr_processing"
  | "validating"
  | "publishing"
  | "completed";

export type DurableLegalSource = {
  number: string;
  title: string;
  type: string;
  issuer: string;
  issuedDate: string | null;
  effectiveDate: string | null;
  officialPageUrl: string;
  sourceUrl: string;
  sourceLabel: string;
};

export type DurableOcrPage = {
  page: number;
  text: string;
  score: number;
  similarity: number;
  chosenPass: string;
  notices: string[];
};

export type DurableIngestionState = {
  number: string;
  status: DurableIngestionStatus;
  stage: DurableIngestionStage;
  runId: string | null;
  sourceUrl: string;
  extractionMethod: string | null;
  processedPages: number;
  totalPages: number;
  qualityScore: number | null;
  warnings: string[];
  error: string | null;
  updatedAt: string;
};

export type DurableValidationInput = {
  expectedNumber: string;
  issuedDate?: string | null;
  text: string;
  extractionMethod: string;
  qualityScore: number;
  totalPages?: number;
  pages?: DurableOcrPage[];
};

export type DurableValidationResult = {
  accepted: boolean;
  status: "ready" | "needs_review";
  warnings: string[];
  metrics: {
    characters: number;
    legalMarkers: number;
    articleMarkers: number;
    chapterMarkers: number;
    unreadableMarkers: number;
    coveredPages: number;
    totalPages: number;
    pageCoverage: number;
    minimumPageScore: number | null;
  };
};

export const EXTRACTION_PRIORITY = ["docx", "doc", "pdf_text", "html", "ocr"] as const;

export function normalizeDocumentNumber(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("vi");
}

export function documentStorageKey(value: string) {
  return normalizeDocumentNumber(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

export function extractionPriority(method: string) {
  const index = EXTRACTION_PRIORITY.indexOf(method as (typeof EXTRACTION_PRIORITY)[number]);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function pageBatches(totalPages: number, batchSize = 3) {
  const safeTotal = Math.max(0, Math.floor(totalPages));
  const safeBatch = Math.max(1, Math.floor(batchSize));
  const batches: number[][] = [];
  for (let first = 1; first <= safeTotal; first += safeBatch) {
    batches.push(
      Array.from(
        { length: Math.min(safeBatch, safeTotal - first + 1) },
        (_item, index) => first + index,
      ),
    );
  }
  return batches;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("vi")
    .trim();
}

function dateSignals(value: string | null | undefined) {
  if (!value || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return [];
  const [year, month, day] = value.split("-").map(Number);
  const paddedDay = String(day).padStart(2, "0");
  const paddedMonth = String(month).padStart(2, "0");
  return Array.from(new Set([
    `${day}/${month}/${year}`,
    `${paddedDay}/${paddedMonth}/${year}`,
    `ngay ${day} thang ${month} nam ${year}`,
    `ngay ${paddedDay} thang ${month} nam ${year}`,
    `ngay ${day} thang ${paddedMonth} nam ${year}`,
    `ngay ${paddedDay} thang ${paddedMonth} nam ${year}`,
  ]));
}

function pageCoverage(totalPages: number, pages: DurableOcrPage[]) {
  if (totalPages <= 0) return { coveredPages: 0, ratio: 1, missing: [] as number[] };
  const covered = new Set(
    pages
      .filter((page) => page.page >= 1 && page.page <= totalPages && page.text.trim().length >= 40)
      .map((page) => page.page),
  );
  const missing = Array.from({ length: totalPages }, (_item, index) => index + 1).filter(
    (page) => !covered.has(page),
  );
  return { coveredPages: covered.size, ratio: covered.size / totalPages, missing };
}

export function validateDurableLegalText(input: DurableValidationInput): DurableValidationResult {
  const text = input.text.trim();
  const warnings: string[] = [];
  const normalizedOpening = normalizeText(text.slice(0, 30_000)).replace(/\s+/g, "");
  const expectedNumber = normalizeDocumentNumber(input.expectedNumber);
  const legalMarkers = text.match(/^\s*(?:Điều|Chương|Mục|Khoản)\s+[0-9IVXLC]+/gimu)?.length ?? 0;
  const articleMarkers = text.match(/^\s*Điều\s+\d+[a-zA-Z]?\b/gimu)?.length ?? 0;
  const chapterMarkers = text.match(/^\s*Chương\s+[IVXLC\d]+\b/gimu)?.length ?? 0;
  const unreadableMarkers = text.match(/\[không đọc rõ\]/giu)?.length ?? 0;
  const pages = input.pages ?? [];
  const totalPages = Math.max(0, Math.floor(input.totalPages ?? 0));
  const coverage = pageCoverage(totalPages, pages);
  const minimumPageScore = pages.length
    ? Math.min(...pages.map((page) => Number.isFinite(page.score) ? page.score : 0))
    : null;

  if (text.length < 800) warnings.push("Toàn văn có ít hơn 800 ký tự.");
  if (looksLikeGovernmentPortalShell(text)) {
    warnings.push("Nội dung giống phần khung menu/thời tiết của Cổng Chính phủ.");
  }
  if (expectedNumber && !normalizedOpening.includes(expectedNumber)) {
    warnings.push(`Không tìm thấy đúng số hiệu ${input.expectedNumber} trong phần đầu toàn văn.`);
  }
  const normalizedText = normalizeText(text.slice(0, 20_000));
  const expectedDateSignals = dateSignals(input.issuedDate);
  if (expectedDateSignals.length && !expectedDateSignals.some((signal) => normalizedText.includes(signal))) {
    warnings.push(`Không xác nhận được ngày ban hành ${input.issuedDate} trong phần đầu văn bản.`);
  }
  if (legalMarkers < 2 && !(text.length >= 5_000 && /\b(?:THÔNG TƯ|NGHỊ ĐỊNH|LUẬT|NGHỊ QUYẾT|QUYẾT ĐỊNH)\b/u.test(text))) {
    warnings.push("Thiếu cấu trúc Điều/Chương/Mục/Khoản để xác nhận toàn văn pháp luật.");
  }
  const minimumScore = input.extractionMethod === "ocr" ? 0.68 : 0.54;
  if (input.qualityScore < minimumScore) {
    warnings.push(`Điểm chất lượng ${Math.round(input.qualityScore * 100)}% thấp hơn ngưỡng ${Math.round(minimumScore * 100)}%.`);
  }
  if (totalPages > 0 && coverage.ratio < 1) {
    warnings.push(`Thiếu nội dung đạt yêu cầu ở trang ${coverage.missing.join(", ")} (${coverage.coveredPages}/${totalPages} trang).`);
  }
  if (minimumPageScore !== null && minimumPageScore < 0.62) {
    warnings.push(`Có trang OCR chỉ đạt ${Math.round(minimumPageScore * 100)}% chất lượng.`);
  }
  if (unreadableMarkers > Math.max(2, Math.ceil(Math.max(1, totalPages) * 0.15))) {
    warnings.push(`Còn ${unreadableMarkers} vùng [không đọc rõ], vượt ngưỡng tự động công bố.`);
  }
  if (pages.some((page) => page.similarity > 0 && page.similarity < 0.72)) {
    warnings.push("Có trang mà hai lượt OCR khác nhau đáng kể.");
  }
  if (articleMarkers > 1) {
    const articleNumbers = [...text.matchAll(/^\s*Điều\s+(\d+)[a-zA-Z]?\b/gimu)].map((match) => Number(match[1]));
    const backwardJump = articleNumbers.some((number, index) => index > 0 && number < articleNumbers[index - 1]);
    if (backwardJump) warnings.push("Thứ tự Điều bị lùi, có thể do ghép trang sai hoặc lặp nội dung.");
  }

  return {
    accepted: warnings.length === 0,
    status: warnings.length === 0 ? "ready" : "needs_review",
    warnings,
    metrics: {
      characters: text.length,
      legalMarkers,
      articleMarkers,
      chapterMarkers,
      unreadableMarkers,
      coveredPages: coverage.coveredPages,
      totalPages,
      pageCoverage: coverage.ratio,
      minimumPageScore,
    },
  };
}
