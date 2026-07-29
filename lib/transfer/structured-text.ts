export const TRANSFER_EXTRACTION_VERSION = 2;
export const TRANSFER_TABLE_CELL_MARKER = "\uE000";
export const TRANSFER_TABLE_ROW_MARKER = "\uE001";
export const TRANSFER_TABLE_START_MARKER = "\uE002";
export const TRANSFER_TABLE_END_MARKER = "\uE003";

function normalizeCell(value: string) {
  return value.replace(/\u00a0/gu, " ").replace(/[ ]{2,}/gu, " ").trim();
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
  const sourceLines = prepared.split("\n");
  const tableLine = sourceLines.map((line) => {
    const cells = line.split("\t").map(normalizeCell);
    return cells.filter(Boolean).length >= 2 ? cells : null;
  });
  const normalized = sourceLines.map((line, index) => {
    const cells = tableLine[index];
    if (!cells) return normalizeCell(line);
    const previousIsTable = index > 0 && Boolean(tableLine[index - 1]);
    const nextIsTable = index + 1 < tableLine.length && Boolean(tableLine[index + 1]);
    return `${previousIsTable ? "" : TRANSFER_TABLE_START_MARKER}${cells.join(TRANSFER_TABLE_CELL_MARKER)}${TRANSFER_TABLE_ROW_MARKER}${nextIsTable ? "" : TRANSFER_TABLE_END_MARKER}`;
  });
  return normalized.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}
