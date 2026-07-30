export const TRANSFER_EXTRACTION_VERSION = 2;
export const TRANSFER_TABLE_CELL_MARKER = "\uE000";
export const TRANSFER_TABLE_ROW_MARKER = "\uE001";
export const TRANSFER_TABLE_START_MARKER = "\uE002";
export const TRANSFER_TABLE_END_MARKER = "\uE003";

const EXPLICIT_TABLE_START = /^\s*\[\[(?:TABLE|BẢNG|BANG)\]\]\s*$/iu;
const EXPLICIT_TABLE_END = /^\s*\[\[\/(?:TABLE|BẢNG|BANG)\]\]\s*$/iu;
const TABLE_HEADER_HINT = /\b(?:stt|số\s+thứ\s+tự|nhóm\s+tiêu\s+chí|tiêu\s+chí|nội\s+dung|mã|đơn\s+vị|số\s+tiền|tỷ\s+trọng|trạng\s+thái|ngày|tháng|năm|ghi\s+chú)\b/iu;

function normalizeCell(value: string) {
  return value
    .replace(/[\uE000-\uE003]/gu, " ")
    .replace(/\u00a0/gu, " ")
    .replace(/[ ]{2,}/gu, " ")
    .trim();
}

function tableCells(line: string, explicit = false) {
  if (line.includes("\t")) {
    const cells = line.split("\t").map(normalizeCell);
    const meaningful = cells.filter(Boolean).length;
    return cells.length >= 2 && (explicit || meaningful >= 2) ? cells : null;
  }

  const pipes = line.match(/\|/gu)?.length ?? 0;
  if (!pipes) return null;
  const source = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  const cells = source.split("|").map(normalizeCell);
  const meaningful = cells.filter(Boolean).length;
  if (cells.length < 2) return null;
  if (!explicit && meaningful < 2 && cells.length < 3) return null;
  return cells;
}

function separatorRow(cells: string[]) {
  const meaningful = cells.filter(Boolean);
  return meaningful.length > 0 && meaningful.every((cell) => /^:?-{2,}:?$/u.test(cell));
}

function encodeTable(rows: string[][]) {
  const columnCount = Math.max(...rows.map((row) => row.length));
  const body = rows
    .map((row) => Array.from({ length: columnCount }, (_, index) => normalizeCell(row[index] ?? ""))
      .join(TRANSFER_TABLE_CELL_MARKER))
    .join(TRANSFER_TABLE_ROW_MARKER);
  return `${TRANSFER_TABLE_START_MARKER}${body}${TRANSFER_TABLE_ROW_MARKER}${TRANSFER_TABLE_END_MARKER}`;
}

function shouldEncodeTable(rows: string[][], explicit: boolean) {
  if (!rows.length) return false;
  const columnCount = Math.max(...rows.map((row) => row.length));
  if (columnCount < 2) return false;
  if (explicit || rows.length >= 2) return true;
  const sample = rows[0].join(" ");
  return columnCount >= 4 && (TABLE_HEADER_HINT.test(sample) || rows[0].filter(Boolean).length >= 4);
}

function tableNeighbor(lines: string[], start: number, direction: -1 | 1) {
  for (let index = start + direction; index >= 0 && index < lines.length; index += direction) {
    if (!lines[index].trim()) continue;
    return tableCells(lines[index]) != null;
  }
  return false;
}

function removePageMarkersBetweenTableRows(lines: string[]) {
  return lines.filter((line, index) => {
    if (!/^\s*\d{1,4}\s*$/u.test(line)) return true;
    return !(tableNeighbor(lines, index, -1) && tableNeighbor(lines, index, 1));
  });
}

/**
 * Chuyển bảng TSV, bảng dùng dấu | và bảng do OCR đánh dấu thành marker nội bộ.
 * Marker giữ nguyên hàng và ô để giao diện dựng lại bảng thay vì dồn thành văn xuôi.
 */
export function structureTransferredTables(value: string) {
  const prepared = value.replace(/\r\n?/gu, "\n").replace(/\u00a0/gu, " ");
  const lines = removePageMarkersBetweenTableRows(prepared.split("\n"));
  const output: string[] = [];
  let rows: string[][] = [];
  let explicit = false;

  const flush = (force = false) => {
    const marked = force || explicit;
    if (shouldEncodeTable(rows, marked)) output.push(encodeTable(rows));
    else output.push(...rows.map((row) => row.join(" | ")));
    rows = [];
  };

  for (const rawLine of lines) {
    if (rawLine.includes(TRANSFER_TABLE_START_MARKER) || rawLine.includes(TRANSFER_TABLE_END_MARKER)) {
      flush();
      output.push(rawLine.trim());
      continue;
    }
    if (EXPLICIT_TABLE_START.test(rawLine)) {
      flush();
      explicit = true;
      continue;
    }
    if (EXPLICIT_TABLE_END.test(rawLine)) {
      flush(true);
      explicit = false;
      continue;
    }

    const cells = tableCells(rawLine, explicit);
    if (cells) {
      if (!separatorRow(cells)) rows.push(cells);
      continue;
    }

    if (explicit) {
      const continuation = normalizeCell(rawLine);
      if (continuation && rows.length) {
        const row = rows.at(-1)!;
        let target = row.length - 1;
        while (target > 0 && !row[target]) target -= 1;
        row[target] = normalizeCell(`${row[target] ?? ""} ${continuation}`);
      }
      continue;
    }

    if (rows.length) flush();
    output.push(normalizeCell(rawLine));
  }

  flush(explicit);
  return output.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

export function normalizeTransferredText(value: string) {
  const prepared = value
    // Classic Word uses control character 0x07 at table-cell/row boundaries.
    .replace(/\r\u0007/gu, "\n")
    .replace(/\u0007(?=\r?\n|$)/gu, "\n")
    .replace(/\u0007/gu, "\t")
    .replace(/\u000b/gu, "\n")
    .replace(/\r\n?/gu, "\n")
    .replace(/\u00a0/gu, " ");
  return structureTransferredTables(prepared);
}
