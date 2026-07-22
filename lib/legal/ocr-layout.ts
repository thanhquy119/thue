export type OcrTableFirstColumn = "index" | "label" | "auto";

export type OcrPreviewBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string; level: 2 | 3 }
  | { kind: "article"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; marker: string; text: string }
  | { kind: "checkbox"; checked: boolean; text: string }
  | { kind: "field"; label: string; value: string }
  | { kind: "note"; text: string }
  | {
      kind: "table";
      rows: string[][];
      headerRows: number;
      columnCount: number;
      firstColumn: OcrTableFirstColumn;
    };

function normalize(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeComparable(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/giu, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uppercaseRatio(value: string) {
  const letters = value.match(/\p{L}/gu) ?? [];
  const uppercase = value.match(/\p{Lu}/gu) ?? [];
  return letters.length ? uppercase.length / letters.length : 0;
}

function isPrimaryTitle(line: string) {
  return (
    /^(?:CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM|Độc lập\s*[-–—]\s*Tự do\s*[-–—]\s*Hạnh phúc)$/iu.test(line) ||
    /^(?:THÔNG TƯ|NGHỊ ĐỊNH|NGHỊ QUYẾT|QUYẾT ĐỊNH|LUẬT|THÔNG BÁO)$/iu.test(line) ||
    /^(?:PHỤ LỤC|BIỂU MẪU HỒ SƠ|THUYẾT MINH CÔNG NGHỆ|ĐƠN ĐỀ NGHỊ|BÁO CÁO THẨM ĐỊNH)/iu.test(line)
  );
}

function isHeading(line: string) {
  if (/^(?:CHƯƠNG|MỤC|PHẦN)\s+[IVXLCDM\d]+\b/iu.test(line)) return 2;
  if (/^[IVXLCDM]+[.)]\s+/u.test(line)) return 2;
  if (/^\d+[.)]\s+[A-ZÀ-ỸĐ]/u.test(line) && line.length < 180) return 3;
  if (line.length >= 8 && line.length <= 180 && uppercaseRatio(line) >= 0.72) return 3;
  return 0;
}

function isSeparatorCell(value: string) {
  return /^:?-{3,}:?$/u.test(value.trim());
}

function pipeCount(value: string) {
  return (value.match(/\|/g) ?? []).length;
}

function parsePipeCells(line: string): string[] | null {
  if (pipeCount(line) < 1) return null;
  const stripped = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = stripped.split("|").map((cell) => cell.trim());
  if (cells.length < 2 || cells.every((cell) => !cell)) return null;
  return cells;
}

function parseFormRow(line: string): string[] | null {
  const match = line.match(/^Mẫu\s+số\s+(\d{1,3})\s*(?:[|:–—-]\s*)?(.+)$/iu);
  if (!match) return null;
  return [`Mẫu số ${match[1].padStart(2, "0")}`, match[2].trim()];
}

function isTableTag(line: string) {
  return /^\[\/?TABLE\]$/iu.test(line.trim());
}

function isTableLikeLine(line: string, tagged = false) {
  if (isTableTag(line)) return true;
  if (tagged) return true;
  if (pipeCount(line) >= 2) return true;
  return /^\s*\|/.test(line) && /\|\s*$/.test(line);
}

function isFillerOnly(line: string) {
  const compact = line.replace(/\s+/g, "");
  if (compact.length < 5) return false;
  if (/^[.…·_─━—–-]+$/u.test(compact)) return true;
  const decorative = compact.match(/[.…·_─━—–-]/gu)?.length ?? 0;
  const letters = compact.match(/\p{L}/gu)?.length ?? 0;
  return decorative / compact.length >= 0.72 && letters <= 2;
}

function appendCell(base: string, addition: string) {
  if (!addition) return base;
  if (!base) return addition;
  return `${base} ${addition}`.replace(/\s+/g, " ").trim();
}

function mergeRows(base: string[], continuation: string[], columnCount: number) {
  const merged = Array.from({ length: columnCount }, (_, index) => base[index] ?? "");
  continuation.forEach((cell, index) => {
    if (!cell) return;
    const target = index < columnCount ? index : columnCount - 1;
    merged[target] = appendCell(merged[target], cell);
  });
  return merged;
}

function inferColumnCount(rows: string[][], separatorColumns: number) {
  if (separatorColumns >= 2) return Math.min(10, separatorColumns);
  return Math.max(2, Math.min(10, ...rows.map((row) => row.length)));
}

function normalizeRowWidth(row: string[], columnCount: number) {
  if (row.length === columnCount) return [...row];
  if (row.length < columnCount) return [...row, ...Array.from({ length: columnCount - row.length }, () => "")];
  return [...row.slice(0, columnCount - 1), row.slice(columnCount - 1).filter(Boolean).join(" ")];
}

function moveTrailingCheckboxes(row: string[], headers: string[]) {
  if (row.length < 4 || !row[1]) return row;
  const normalizedHeaders = headers.map(normalizeComparable);
  const passColumn = normalizedHeaders.findIndex((value) => value === "dat");
  const failColumn = normalizedHeaders.findIndex((value) => value === "khong dat");
  if (passColumn < 0 || failColumn < 0 || row[passColumn] || row[failColumn]) return row;

  const matches = row[1].match(/(?:□|☐|☑|✓|✔)/gu) ?? [];
  if (matches.length < 2) return row;
  const cleaned = row[1].replace(/(?:\s*(?:□|☐|☑|✓|✔)){2,}\s*$/u, "").trim();
  const next = [...row];
  next[1] = cleaned;
  next[passColumn] = matches[0];
  next[failColumn] = matches[1];
  return next;
}

function headerTokenCount(row: string[]) {
  const text = normalizeComparable(row.join(" "));
  const tokens = [
    "stt",
    "ho va ten",
    "noi dung",
    "linh vuc",
    "co quan cong tac",
    "chuc danh",
    "dat",
    "khong dat",
    "nhan xet",
    "yeu cau giai trinh",
  ];
  return tokens.filter((token) => text.includes(token)).length;
}

function inferHeaderRows(rows: string[][]) {
  if (!rows.length) return 0;
  const firstCell = normalizeComparable(rows[0][0] ?? "");
  if (firstCell === "stt" || firstCell === "so thu tu" || headerTokenCount(rows[0]) >= 2) return 1;
  return 0;
}

function inferFirstColumn(rows: string[][], headerRows: number): OcrTableFirstColumn {
  const first = normalizeComparable(rows[0]?.[0] ?? "");
  if (first === "stt" || first === "so thu tu") return "index";
  if (/^mau so\s+\d+/u.test(first)) return "label";

  const body = rows.slice(headerRows).map((row) => row[0]?.trim() ?? "").filter(Boolean);
  const indexLike = body.filter((value) => /^(?:\d+|\.{2,}|…+)$/u.test(value)).length;
  if (body.length >= 2 && indexLike / body.length >= 0.6) return "index";
  return "auto";
}

function buildTable(rawLines: string[]) {
  const rows: string[][] = [];
  let separatorColumns = 0;
  let tagged = false;

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (/^\[TABLE\]$/iu.test(line)) {
      tagged = true;
      continue;
    }
    if (/^\[\/TABLE\]$/iu.test(line)) {
      tagged = false;
      continue;
    }

    const cells = parsePipeCells(line);
    if (!cells) {
      if (tagged && rows.length && !isFillerOnly(line)) {
        rows[rows.length - 1][rows[rows.length - 1].length - 1] = appendCell(
          rows[rows.length - 1][rows[rows.length - 1].length - 1],
          line,
        );
      }
      continue;
    }

    const separatorMask = cells.map(isSeparatorCell);
    const separatorCount = separatorMask.filter(Boolean).length;
    if (separatorCount === cells.length) {
      separatorColumns = Math.max(separatorColumns, separatorCount);
      continue;
    }

    if (separatorCount >= 2) {
      separatorColumns = Math.max(separatorColumns, separatorCount);
      const continuation = cells.filter((cell, index) => !separatorMask[index] && cell);
      if (continuation.length && rows.length) {
        const expected = Math.max(separatorColumns, rows[rows.length - 1].length + continuation.length);
        const previous = rows[rows.length - 1];
        continuation.forEach((cell) => {
          if (previous.length < expected) previous.push(cell);
          else previous[previous.length - 1] = appendCell(previous[previous.length - 1], cell);
        });
      }
      continue;
    }

    rows.push(cells);
  }

  if (rows.length < 2) return null;
  const columnCount = inferColumnCount(rows, separatorColumns);
  let normalizedRows = rows.map((row) => normalizeRowWidth(row, columnCount));

  const merged: string[][] = [];
  for (const row of normalizedRows) {
    const previous = merged[merged.length - 1];
    const key = normalizeComparable(row[0] ?? "");
    const previousKey = normalizeComparable(previous?.[0] ?? "");
    const nonEmpty = row.filter(Boolean).length;

    if (previous && (!key || (key === previousKey && key.length > 0))) {
      merged[merged.length - 1] = mergeRows(previous, row, columnCount);
      continue;
    }
    if (previous && nonEmpty === 1 && !row[0]) {
      merged[merged.length - 1] = mergeRows(previous, row, columnCount);
      continue;
    }
    merged.push(row);
  }
  normalizedRows = merged;

  const headerRows = inferHeaderRows(normalizedRows);
  if (headerRows) {
    normalizedRows = normalizedRows.map((row, index) => (
      index < headerRows ? row : moveTrailingCheckboxes(row, normalizedRows[0])
    ));
  }

  return {
    kind: "table" as const,
    rows: normalizedRows,
    headerRows,
    columnCount,
    firstColumn: inferFirstColumn(normalizedRows, headerRows),
  };
}

function parseField(line: string) {
  if (isFillerOnly(line) || line.includes("|")) return null;
  const match = line.match(/^(.*?)(?:\.{5,}|…{2,}|_{5,})(.*)$/u);
  if (!match || !match[1].trim()) return null;
  const label = match[1].trim();
  if ((label.match(/\p{L}/gu) ?? []).length < 3) return null;
  const rawValue = match[2].trim();
  return { label, value: isFillerOnly(rawValue) ? "" : rawValue };
}

function appendParagraph(blocks: OcrPreviewBlock[], text: string) {
  const cleaned = text
    .replace(/^\|+|\|+$/g, "")
    .replace(/\s*\|{2,}\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || isFillerOnly(cleaned)) return;

  const previous = blocks[blocks.length - 1];
  if (previous?.kind === "paragraph" && !/[.;:!?]$/u.test(previous.text)) {
    previous.text = `${previous.text} ${cleaned}`.replace(/\s+/g, " ").trim();
    return;
  }
  blocks.push({ kind: "paragraph", text: cleaned });
}

export function buildOcrPreviewBlocks(value: string): OcrPreviewBlock[] {
  const lines = normalize(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const blocks: OcrPreviewBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (isTableTag(line) || parsePipeCells(line)) {
      const tableLines: string[] = [];
      let cursor = index;
      let tagged = /^\[TABLE\]$/iu.test(line);
      while (cursor < lines.length) {
        const candidate = lines[cursor];
        if (!isTableLikeLine(candidate, tagged)) break;
        tableLines.push(candidate);
        if (/^\[TABLE\]$/iu.test(candidate)) tagged = true;
        if (/^\[\/TABLE\]$/iu.test(candidate)) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      const table = buildTable(tableLines);
      if (table) {
        blocks.push(table);
        index = cursor - 1;
        continue;
      }
    }

    const formRows: string[][] = [];
    let formCursor = index;
    while (formCursor < lines.length) {
      const row = parseFormRow(lines[formCursor]);
      if (!row) break;
      formRows.push(row);
      formCursor += 1;
    }
    if (formRows.length >= 2) {
      blocks.push({
        kind: "table",
        rows: formRows,
        headerRows: 0,
        columnCount: 2,
        firstColumn: "label",
      });
      index = formCursor - 1;
      continue;
    }

    if (isFillerOnly(line)) continue;

    const checkbox = line.match(/^(□|☐|☑|✓|✔|\[\s?[xX]?\s?\])\s*(.+)$/u);
    if (checkbox) {
      blocks.push({
        kind: "checkbox",
        checked: /(?:☑|✓|✔|x)/iu.test(checkbox[1]),
        text: checkbox[2].trim(),
      });
      continue;
    }

    const field = parseField(line);
    if (field) {
      blocks.push({ kind: "field", ...field });
      continue;
    }

    if (/^Ghi chú\s*:/iu.test(line)) {
      blocks.push({ kind: "note", text: line });
      continue;
    }

    if (/^Điều\s+\d+[a-z]?\s*[.:-]/iu.test(line)) {
      blocks.push({ kind: "article", text: line });
      continue;
    }

    if (/^(?:Mẫu\s+số\s+\d+|Số\s*:|Hà Nội,\s*ngày|Kèm theo Thông tư)/iu.test(line)) {
      blocks.push({ kind: "heading", text: line, level: 3 });
      continue;
    }

    if (isPrimaryTitle(line)) {
      blocks.push({ kind: "title", text: line });
      continue;
    }

    const headingLevel = isHeading(line);
    if (headingLevel) {
      blocks.push({ kind: "heading", text: line, level: headingLevel as 2 | 3 });
      continue;
    }

    const list = line.match(/^((?:\d+|[a-zđ]|[ivxlcdm]+)[.)])\s+(.+)$/iu);
    if (list) {
      blocks.push({ kind: "list", marker: list[1], text: list[2].trim() });
      continue;
    }

    appendParagraph(blocks, line);
  }

  return blocks;
}
