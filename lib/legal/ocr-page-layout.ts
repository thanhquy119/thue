import { buildOcrPreviewBlocks, type OcrPreviewBlock } from "./ocr-layout.ts";

type TableBlock = Extract<OcrPreviewBlock, { kind: "table" }> & {
  continued?: boolean;
  notices?: string[];
};

export type OcrPreviewPage = {
  page: number;
  blocks: OcrPreviewBlock[];
};

function comparable(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/giu, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cloneTable(table: TableBlock): TableBlock {
  return {
    ...table,
    rows: table.rows.map((row) => [...row]),
    notices: table.notices ? [...table.notices] : undefined,
  };
}

function firstTable(blocks: OcrPreviewBlock[]) {
  const index = blocks.findIndex((block) => block.kind === "table");
  const block = index >= 0 ? blocks[index] : null;
  return block?.kind === "table" ? { index, table: block as TableBlock } : null;
}

function lastTable(blocks: OcrPreviewBlock[]) {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.kind === "table") return { index, table: block as TableBlock };
  }
  return null;
}

function headerIndex(headers: string[], patterns: RegExp[]) {
  return headers.findIndex((value) => patterns.some((pattern) => pattern.test(comparable(value))));
}

function tableSchema(table: TableBlock) {
  const header = table.headerRows ? table.rows[0] ?? [] : [];
  return {
    columns: table.columnCount,
    headerRows: table.headerRows,
    headers: table.rows.slice(0, table.headerRows).map((row) => [...row]),
    firstColumn: table.firstColumn,
    indexColumn: headerIndex(header, [/^stt$/u, /^so thu tu$/u]),
    contentColumn: headerIndex(header, [/noi dung/u, /ho va ten/u, /ten mau/u, /tieu chi/u]),
    passColumn: headerIndex(header, [/^dat$/u]),
    failColumn: headerIndex(header, [/^khong dat$/u]),
  };
}

function checkboxTokens(value: string) {
  return value.match(/(?:□|☐|☑|✓|✔)/gu) ?? [];
}

function stripTrailingCheckboxes(value: string) {
  return value.replace(/(?:\s*(?:□|☐|☑|✓|✔)){1,}\s*$/u, "").trim();
}

function appendText(base: string, addition: string) {
  if (!addition) return base;
  if (!base) return addition;
  const left = comparable(base);
  const right = comparable(addition);
  if (!right || left === right || left.endsWith(right)) return base;
  return `${base} ${addition}`.replace(/\s+/g, " ").trim();
}

function normalizeContinuationRow(row: string[], previous: TableBlock, notices: string[]) {
  const schema = tableSchema(previous);
  const normalized = Array.from({ length: schema.columns }, () => "");
  const values = row.map((value) => value.trim());
  const first = values[0] ?? "";
  const indexColumn = schema.indexColumn >= 0 ? schema.indexColumn : 0;
  const contentColumn = schema.contentColumn >= 0 ? schema.contentColumn : Math.min(1, schema.columns - 1);

  if (/^(?:\d+|\.{2,}|…+)$/u.test(first)) normalized[indexColumn] = first;

  const remaining = values.slice(normalized[indexColumn] ? 1 : 0).filter(Boolean);
  const checkboxes = remaining.flatMap(checkboxTokens);
  const textParts = remaining
    .map(stripTrailingCheckboxes)
    .filter((value) => value && !/^(?:□|☐|☑|✓|✔)(?:\s+(?:□|☐|☑|✓|✔))*$/u.test(value));
  normalized[contentColumn] = textParts.join(" ").replace(/\s+/g, " ").trim();

  if (schema.passColumn >= 0 && checkboxes[0]) normalized[schema.passColumn] = checkboxes[0];
  if (schema.failColumn >= 0 && checkboxes[1]) normalized[schema.failColumn] = checkboxes[1];
  if (checkboxes.length === 1 && schema.passColumn >= 0 && schema.failColumn >= 0) {
    notices.push("Một hàng của bảng tiếp nối chỉ nhận diện được một trong hai ô lựa chọn; ô còn lại được để trống để tránh suy đoán.");
  }

  if (row.length === schema.columns) {
    row.forEach((cell, index) => {
      if (!normalized[index] && cell.trim()) normalized[index] = cell.trim();
    });
  }
  return normalized;
}

function looksLikeContinuationText(block: OcrPreviewBlock) {
  if (block.kind !== "paragraph") return false;
  const value = block.text.trim();
  if (!value || value.length > 520) return false;
  if (/^(?:Điều|Chương|Mục|Phần|Phụ lục|Mẫu số|CỘNG HÒA|THÔNG TƯ|NGHỊ ĐỊNH|QUYẾT ĐỊNH)\b/iu.test(value)) return false;
  return /^[a-zà-ỹđ(,;:]/u.test(value) || !/[.!?:;]$/u.test(value);
}

function numericIndex(value: string) {
  return /^\d+$/u.test(value.trim()) ? Number(value.trim()) : null;
}

function bodyRows(table: TableBlock) {
  return table.rows.slice(table.headerRows);
}

function tableHeadersEqual(left: TableBlock, right: TableBlock) {
  if (!left.headerRows || !right.headerRows || left.columnCount !== right.columnCount) return false;
  const leftHeader = left.rows.slice(0, left.headerRows).flat().map(comparable).join("|");
  const rightHeader = right.rows.slice(0, right.headerRows).flat().map(comparable).join("|");
  return leftHeader === rightHeader;
}

function rowsAppearSequential(left: TableBlock, right: TableBlock) {
  const leftRows = bodyRows(left);
  const rightRows = bodyRows(right);
  const last = numericIndex(leftRows[leftRows.length - 1]?.[0] ?? "");
  const first = numericIndex(rightRows[0]?.[0] ?? "");
  if (last === null || first === null) return false;
  return first === last + 1 || first === last;
}

function compatibleTableFragments(left: TableBlock, right: TableBlock) {
  if (tableHeadersEqual(left, right)) return true;
  if (left.firstColumn !== "index") return false;
  if (right.headerRows) return false;
  return rowsAppearSequential(left, right);
}

function attachParagraphToLastRow(table: TableBlock, blocks: OcrPreviewBlock[]) {
  if (!blocks.length || !blocks.every(looksLikeContinuationText)) return false;
  const lastRow = table.rows[table.rows.length - 1];
  if (!lastRow || table.rows.length <= table.headerRows) return false;
  const schema = tableSchema(table);
  const target = schema.contentColumn >= 0 ? schema.contentColumn : Math.min(1, table.columnCount - 1);
  const text = blocks.map((block) => block.kind === "paragraph" ? block.text : "").join(" ").trim();
  lastRow[target] = appendText(lastRow[target] ?? "", text);
  return true;
}

function mergeAdjacentTablesOnPage(page: OcrPreviewPage) {
  const output: OcrPreviewBlock[] = [];
  let index = 0;

  while (index < page.blocks.length) {
    const block = page.blocks[index];
    if (block?.kind !== "table") {
      if (block) output.push(block);
      index += 1;
      continue;
    }

    const merged = cloneTable(block);
    let cursor = index + 1;
    while (cursor < page.blocks.length) {
      const between: OcrPreviewBlock[] = [];
      while (cursor < page.blocks.length && page.blocks[cursor]?.kind !== "table") {
        const candidate = page.blocks[cursor];
        if (!candidate || !looksLikeContinuationText(candidate)) break;
        between.push(candidate);
        cursor += 1;
      }

      const next = page.blocks[cursor];
      if (next?.kind !== "table") break;
      const nextTable = next as TableBlock;
      if (!compatibleTableFragments(merged, nextTable)) break;
      if (between.length) attachParagraphToLastRow(merged, between);

      const notices = [...(merged.notices ?? []), ...(nextTable.notices ?? [])];
      const rows = nextTable.headerRows ? bodyRows(nextTable) : nextTable.rows;
      const normalizedRows = rows.map((row) => normalizeContinuationRow(row, merged, notices));
      merged.rows.push(...normalizedRows);
      merged.notices = [...new Set(notices)];
      cursor += 1;
    }

    output.push(merged);
    index = cursor;
  }

  page.blocks = output;
}

function attachLeadingContinuation(previousPage: OcrPreviewPage, currentPage: OcrPreviewPage) {
  const previousResult = lastTable(previousPage.blocks);
  const currentResult = firstTable(currentPage.blocks);
  if (!previousResult || !currentResult) return;

  const leading = currentPage.blocks.slice(0, currentResult.index);
  if (!attachParagraphToLastRow(previousResult.table, leading)) return;
  currentPage.blocks.splice(0, currentResult.index);
}

function mergeRepeatedFirstRow(previous: TableBlock, rows: string[][], notices: string[]) {
  const previousLast = previous.rows[previous.rows.length - 1];
  const first = rows[0];
  if (!previousLast || !first) return rows;
  const previousIndex = numericIndex(previousLast[0] ?? "");
  const currentIndex = numericIndex(first[0] ?? "");
  if (previousIndex === null || currentIndex === null || previousIndex !== currentIndex) return rows;
  for (let index = 0; index < previous.columnCount; index += 1) {
    previousLast[index] = appendText(previousLast[index] ?? "", first[index] ?? "");
  }
  notices.push(`Hàng ${currentIndex} bị cắt qua hai trang đã được ghép vào cùng một hàng.`);
  return rows.slice(1);
}

function carryTableSchema(previousPage: OcrPreviewPage, currentPage: OcrPreviewPage) {
  const previousResult = lastTable(previousPage.blocks);
  const currentResult = firstTable(currentPage.blocks);
  if (!previousResult || !currentResult) return;

  const previous = previousResult.table;
  const current = currentResult.table;
  if (!previous.headerRows) return;

  if (current.headerRows) {
    if (!tableHeadersEqual(previous, current)) return;
    const repeated = cloneTable(current);
    repeated.continued = true;
    repeated.notices = [...new Set([...(repeated.notices ?? []), "Bảng lặp lại hàng tiêu đề ở trang mới và được đánh dấu là phần tiếp theo."])];
    currentPage.blocks[currentResult.index] = repeated;
    return;
  }

  if (previous.firstColumn !== "index") return;
  const firstBodyValue = current.rows[0]?.[0]?.trim() ?? "";
  if (!/^(?:\d+|\.{2,}|…+)$/u.test(firstBodyValue)) return;

  const notices = [...(current.notices ?? [])];
  const normalized = current.rows.map((row) => normalizeContinuationRow(row, previous, notices));
  const rows = mergeRepeatedFirstRow(previous, normalized, notices);
  if (!rows.length) {
    currentPage.blocks.splice(currentResult.index, 1);
    return;
  }
  const stitched: TableBlock = {
    ...cloneTable(current),
    rows: [...previous.rows.slice(0, previous.headerRows).map((row) => [...row]), ...rows],
    headerRows: previous.headerRows,
    columnCount: previous.columnCount,
    firstColumn: previous.firstColumn,
    continued: true,
    notices: [...new Set(notices)],
  };
  currentPage.blocks[currentResult.index] = stitched;
}

export function buildOcrPreviewPages(pages: Array<{ page: number; text: string }>): OcrPreviewPage[] {
  const prepared = pages
    .map((page) => ({
      page: page.page,
      blocks: buildOcrPreviewBlocks(page.text).map((block) => block.kind === "table" ? cloneTable(block) : { ...block }),
    }))
    .sort((left, right) => left.page - right.page);

  prepared.forEach(mergeAdjacentTablesOnPage);

  for (let index = 1; index < prepared.length; index += 1) {
    const previous = prepared[index - 1];
    const current = prepared[index];
    if (!previous || !current || current.page !== previous.page + 1) continue;
    attachLeadingContinuation(previous, current);
    carryTableSchema(previous, current);
    mergeAdjacentTablesOnPage(current);
  }

  return prepared;
}
