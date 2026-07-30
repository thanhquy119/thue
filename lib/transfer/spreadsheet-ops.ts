export const SPREADSHEET_CONCLUSIONS = {
  MATCH: "KHỚP ĐÚNG",
  MISSING: "THIẾU DỮ LIỆU",
  DATE: "LỆCH NGÀY",
  AMOUNT: "LỆCH TỔNG TIỀN",
  BOTH: "LỆCH NGÀY VÀ TỔNG TIỀN",
} as const;

export type SpreadsheetTableLayout = {
  headerStart: number;
  headerEnd: number;
  dataStart: number;
  confidence: number;
};

export function normalizeSpreadsheetHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/đ/giu, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function populatedIndexes(row: unknown[]) {
  const indexes: number[] = [];
  row.forEach((value, index) => {
    if (String(value ?? "").trim()) indexes.push(index);
  });
  return indexes;
}

function valueKind(value: unknown) {
  if (value == null || String(value).trim() === "") return "blank";
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  const text = String(value).trim();
  if (/^(?:\d{1,2}[/-]){2}\d{2,4}$/u.test(text) || /^\d{4}-\d{1,2}-\d{1,2}/u.test(text)) return "date";
  if (/^[+-]?(?:\d+[.,]?)+%?$/u.test(text.replace(/\s/gu, ""))) return "number";
  return "text";
}

function jaccard(left: number[], right: number[]) {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]).size;
  if (!union) return 1;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / union;
}

function kindSimilarity(left: unknown[], right: unknown[], indexes: number[]) {
  if (!indexes.length) return 0;
  let matched = 0;
  let compared = 0;
  for (const index of indexes) {
    const a = valueKind(left[index]);
    const b = valueKind(right[index]);
    if (a === "blank" || b === "blank") continue;
    compared += 1;
    if (a === b || (a === "date" && b === "number") || (a === "number" && b === "date")) matched += 1;
  }
  return compared ? matched / compared : 0;
}

const HEADER_WORDS = /\b(?:stt|so thu tu|ma|ten|ngay|thang|nam|mst|ma so thue|so hoa don|ky hieu|dia chi|tinh|thanh pho|quan|huyen|phuong|xa|trang thai|ket qua|tong tien|thanh tien|ghi chu|email|dien thoai|ho va ten|cqt|co quan)\b/gu;

function rowStats(row: unknown[]) {
  const indexes = populatedIndexes(row);
  const values = indexes.map((index) => row[index]);
  const normalized = values.map(normalizeSpreadsheetHeader).filter(Boolean);
  const headerWords = normalized.reduce((total, value) => total + (value.match(HEADER_WORDS)?.length ?? 0), 0);
  return {
    indexes,
    populated: indexes.length,
    textLike: values.filter((value) => valueKind(value) === "text").length,
    numericLike: values.filter((value) => valueKind(value) === "number" || valueKind(value) === "date").length,
    unique: new Set(normalized).size,
    headerWords,
  };
}

/**
 * Tìm khối tiêu đề và dòng dữ liệu đầu tiên thay vì chọn dòng đông ô nhất.
 * Cách này chịu được tiêu đề nhiều tầng, ô gộp và các dòng dữ liệu dày đặc.
 */
export function detectSpreadsheetTableLayout(rows: unknown[][], scanLimit = 80): SpreadsheetTableLayout {
  const limit = Math.min(rows.length, Math.max(1, scanLimit));
  const stats = rows.slice(0, limit).map((row) => rowStats(row ?? []));
  let bestDataStart = -1;
  let bestContinuity = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < limit; index += 1) {
    const current = stats[index];
    if (!current || current.populated < 2) continue;
    const comparisons: Array<{ mask: number; kind: number; density: number }> = [];
    for (let offset = 1; offset <= 3 && index + offset < limit; offset += 1) {
      const next = stats[index + offset];
      if (!next || next.populated < 2) continue;
      const overlap = current.indexes.filter((column) => next.indexes.includes(column));
      comparisons.push({
        mask: jaccard(current.indexes, next.indexes),
        kind: kindSimilarity(rows[index] ?? [], rows[index + offset] ?? [], overlap),
        density: Math.min(current.populated, next.populated) / Math.max(current.populated, next.populated),
      });
    }
    if (comparisons.length < Math.min(2, Math.max(0, limit - index - 1))) continue;
    const average = (key: "mask" | "kind" | "density") => comparisons.reduce((sum, item) => sum + item[key], 0) / comparisons.length;
    const continuity = average("mask") * 6 + average("kind") * 4 + average("density") * 2 + Math.min(2, comparisons.length) - index * 0.002;
    // Dòng dữ liệu thường lặp lại cùng tập cột và cùng kiểu giá trị. Chọn dòng ổn định sớm nhất khi điểm gần ngang nhau.
    if (continuity > bestContinuity + 0.2 || (Math.abs(continuity - bestContinuity) <= 0.2 && (bestDataStart < 0 || index < bestDataStart))) {
      bestDataStart = index;
      bestContinuity = continuity;
    }
  }

  if (bestDataStart < 0) {
    let bestHeader = 0;
    let bestHeaderScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < limit; index += 1) {
      const item = stats[index];
      if (!item || item.populated < 2) continue;
      const score = item.headerWords * 6 + item.textLike * 2 + item.unique - item.numericLike * 2 - index * 0.02;
      if (score > bestHeaderScore) {
        bestHeader = index;
        bestHeaderScore = score;
      }
    }
    return { headerStart: bestHeader, headerEnd: bestHeader, dataStart: Math.min(rows.length, bestHeader + 1), confidence: 0.25 };
  }

  let headerEnd = bestDataStart - 1;
  while (headerEnd >= 0 && stats[headerEnd]?.populated === 0) headerEnd -= 1;
  if (headerEnd < 0) {
    return { headerStart: 0, headerEnd: 0, dataStart: bestDataStart, confidence: Math.min(1, bestContinuity / 12) };
  }

  let headerStart = headerEnd;
  const maxHeaderRows = 6;
  for (let index = headerEnd - 1; index >= Math.max(0, headerEnd - maxHeaderRows + 1); index -= 1) {
    const item = stats[index];
    if (!item || item.populated === 0) break;
    const currentBlockHasMultiple = stats.slice(headerStart, headerEnd + 1).some((row) => row.populated >= 2);
    const currentBlockHasDistinctLabels = stats.slice(headerStart, headerEnd + 1).some((row) => row.unique >= 2);
    if (item.populated <= 1 && currentBlockHasMultiple && item.headerWords === 0) break;
    // Tiêu đề lớn thường là một giá trị được trải qua nhiều ô gộp; không nhập nó vào khối tên cột.
    if (item.unique <= 1 && item.populated > 1 && currentBlockHasDistinctLabels && item.headerWords === 0) break;
    const looksLikeHeader = item.headerWords > 0 || item.textLike >= Math.max(1, item.numericLike) || item.populated >= 2;
    if (!looksLikeHeader) break;
    headerStart = index;
  }

  return {
    headerStart,
    headerEnd,
    dataStart: bestDataStart,
    confidence: Math.max(0, Math.min(1, bestContinuity / 12)),
  };
}

export function detectSpreadsheetHeaderRow(rows: unknown[][], scanLimit = 80) {
  return detectSpreadsheetTableLayout(rows, scanLimit).headerStart;
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

export function findSpreadsheetSequenceColumn(headers: unknown[]) {
  return headers.findIndex((header) => /^(?:stt|so thu tu|thu tu|tt)$/u.test(normalizeSpreadsheetHeader(header)));
}

export function nextSpreadsheetSequenceValue(rows: unknown[][], sequenceColumn: number) {
  if (sequenceColumn < 0) return 1;
  let maximum = 0;
  for (const row of rows) {
    const value = row[sequenceColumn];
    const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim().replace(/[^0-9.-]/gu, ""));
    if (Number.isFinite(parsed)) maximum = Math.max(maximum, Math.floor(parsed));
  }
  return maximum + 1;
}
