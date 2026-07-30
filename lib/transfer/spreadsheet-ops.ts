export const SPREADSHEET_CONCLUSIONS = {
  MATCH: "KHỚP ĐÚNG",
  MISSING: "THIẾU DỮ LIỆU",
  DATE: "LỆCH NGÀY",
  AMOUNT: "LỆCH TỔNG TIỀN",
  BOTH: "LỆCH NGÀY VÀ TỔNG TIỀN",
} as const;

export function normalizeSpreadsheetHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/đ/giu, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

export function detectSpreadsheetHeaderRow(rows: unknown[][], scanLimit = 40) {
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  const limit = Math.min(rows.length, scanLimit);
  for (let index = 0; index < limit; index += 1) {
    const values = rows[index] ?? [];
    const populated = values.filter((value) => String(value ?? "").trim()).length;
    const unique = new Set(values.map(normalizeSpreadsheetHeader).filter(Boolean)).size;
    const textLike = values.filter((value) => typeof value === "string" && /\p{L}/u.test(value)).length;
    const score = populated * 4 + unique * 2 + textLike - index * 0.05;
    if (populated >= 2 && score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  return bestIndex;
}

export function mapSpreadsheetHeaders(targetHeaders: unknown[], sourceHeaders: unknown[]) {
  const sourceIndex = new Map<string, number>();
  sourceHeaders.forEach((header, index) => {
    const normalized = normalizeSpreadsheetHeader(header);
    if (normalized && !sourceIndex.has(normalized)) sourceIndex.set(normalized, index);
  });
  return targetHeaders.map((header) => sourceIndex.get(normalizeSpreadsheetHeader(header)) ?? -1);
}

export function shiftSpreadsheetFormula(formula: string, rowDelta: number) {
  if (!rowDelta) return formula;
  return formula.replace(/(\$?[A-Z]{1,3})(\$?)(\d+)/gu, (_match, column: string, absoluteRow: string, row: string) => {
    if (absoluteRow === "$") return `${column}$${row}`;
    return `${column}${Math.max(1, Number(row) + rowDelta)}`;
  });
}

export function classifySpreadsheetConclusion(dateDifference: unknown, amountDifference: unknown) {
  const dateMissing = dateDifference == null || dateDifference === "";
  const amountMissing = amountDifference == null || amountDifference === "";
  if (dateMissing && amountMissing) return SPREADSHEET_CONCLUSIONS.MISSING;
  const date = Number(dateDifference || 0);
  const amount = Number(amountDifference || 0);
  const dateMismatch = Number.isFinite(date) && Math.abs(date) > 0.000001;
  const amountMismatch = Number.isFinite(amount) && Math.abs(amount) > 0.5;
  if (dateMismatch && amountMismatch) return SPREADSHEET_CONCLUSIONS.BOTH;
  if (dateMismatch) return SPREADSHEET_CONCLUSIONS.DATE;
  if (amountMismatch) return SPREADSHEET_CONCLUSIONS.AMOUNT;
  return SPREADSHEET_CONCLUSIONS.MATCH;
}

const DUPLICATE_PATTERNS = {
  seller: [/mst nguoi ban/u, /ma so thue nguoi ban/u, /mst ban/u],
  number: [/so hoa don/u, /so h don/u, /^so$/u],
  symbol: [/ky hieu hoa don/u, /ky hieu/u],
  date: [/ngay hoa don/u, /ngay lap/u],
} as const;

function matchingColumn(headers: unknown[], patterns: readonly RegExp[]) {
  return headers.findIndex((header) => {
    const normalized = normalizeSpreadsheetHeader(header);
    return patterns.some((pattern) => pattern.test(normalized));
  });
}

export function spreadsheetDuplicateKey(headers: unknown[], row: unknown[]) {
  const indexes = [
    matchingColumn(headers, DUPLICATE_PATTERNS.seller),
    matchingColumn(headers, DUPLICATE_PATTERNS.symbol),
    matchingColumn(headers, DUPLICATE_PATTERNS.number),
    matchingColumn(headers, DUPLICATE_PATTERNS.date),
  ];
  const usable = indexes.filter((index) => index >= 0);
  if (usable.length < 2) return null;
  const parts = indexes.map((index) => index >= 0 ? normalizeSpreadsheetHeader(row[index]) : "");
  if (parts.filter(Boolean).length < 2) return null;
  return parts.join("|");
}
