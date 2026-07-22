import type { LabResult, PageResult } from "./ocr-lab-types";

export function scoreLabel(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function recommendationLabel(value: LabResult["recommendation"]) {
  if (value === "prefer_ocr") return "OCR đang tốt hơn lớp chữ PDF";
  if (value === "keep_embedded") return "Nên giữ lớp chữ PDF hiện tại";
  return "Cần kiểm tra thủ công trước khi dùng";
}

export function passLabel(value: PageResult["chosenPass"]) {
  if (value === "consensus") return "Đối chiếu";
  if (value === "literal") return "Lượt A";
  if (value === "structure") return "Lượt B";
  return "Lớp chữ PDF";
}

function recommendation(embeddedScore: number, ocrScore: number): LabResult["recommendation"] {
  if (ocrScore >= 0.7 && ocrScore >= embeddedScore + 0.08) return "prefer_ocr";
  if (embeddedScore >= 0.74 && embeddedScore >= ocrScore - 0.03) return "keep_embedded";
  return "manual_review";
}

function weightedScore(results: LabResult[], key: "embedded" | "ocr") {
  const totalWeight = results.reduce((sum, result) => sum + Math.max(1, result[key].characters), 0);
  return results.reduce(
    (sum, result) => sum + result[key].score * Math.max(1, result[key].characters),
    0,
  ) / Math.max(1, totalWeight);
}

export function mergeResults(results: LabResult[]): LabResult {
  const pages = [...new Map(
    results.flatMap((result) => result.ocr.pages).map((page) => [page.page, page]),
  ).values()].sort((left, right) => left.page - right.page);
  const embeddedText = results.map((result) => result.embedded.text).filter(Boolean).join("\n\n");
  const ocrText = pages.map((page) => page.text).filter(Boolean).join("\n\n");
  const embeddedScore = weightedScore(results, "embedded");
  const ocrScore = pages.length
    ? pages.reduce((sum, page) => sum + page.chosenScore, 0) / pages.length
    : weightedScore(results, "ocr");
  const totalPages = Math.max(...results.map((result) => result.totalPages));
  const warnings = [...new Set(
    results
      .flatMap((result) => result.warnings)
      .filter((warning) => !/^Đợt này đã (?:OCR|xử lý) trang/iu.test(warning)),
  )];
  warnings.push(
    pages.length === totalPages
      ? `Đã hoàn tất phân tích toàn bộ ${totalPages} trang trong chế độ thử nghiệm theo từng đợt nhỏ.`
      : `Đã xử lý ${pages.length}/${totalPages} trang; kết quả đang được cập nhật dần.`,
  );

  return {
    sourceUrl: results[0]?.sourceUrl ?? "",
    model: results[0]?.model ?? "",
    totalPages,
    processedPages: pages.length,
    truncated: pages.length < totalPages,
    embedded: { text: embeddedText, score: embeddedScore, characters: embeddedText.length },
    ocr: { text: ocrText, score: ocrScore, characters: ocrText.length, pages },
    recommendation: recommendation(embeddedScore, ocrScore),
    warnings,
  };
}
