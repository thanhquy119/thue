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

function comparable(value: string) {
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

function headingLevel(line: string) {
  if (/^(?:CHƯƠNG|MỤC|PHẦN)\s+[IVXLCDM\d]+\b/iu.test(line)) return 2;
  if (/^[IVXLCDM]+[.)]\s+/u.test(line)) return 2;
  if (/^\d+[.)]\s+[A-ZÀ-ỸĐ]/u.test(line) && line.length < 180) return 3;
  if (line.length >= 8 && line.length <= 180 && uppercaseRatio(line) >= 0.72) return 3;
  return 0;
}

function pipeCount(value: string) {
  return value.match(/\|/g)?.length ?? 0;
}

function parsePipeCells(line: string) {
  if (!pipeCount(line)) return null;
  const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  return cells.length >= 2 && cells.some(Boolean) ? cells : null;
}

function parseFormRow(line: string) {
  const match = line.match(/^Mẫu\s+số\s+(\d{1,3})\s*(?:[|:–—-]\s*)?(.+)$/iu);
  return match ? [`Mẫu số ${match[1]?.padStart(2, "0")}`, match[2]?.trim() ?? ""] : null;
}

function isSeparatorCell(value: string) {
  return /^:?-{3,}:?$/u.test(value.trim());
}

function isTableTag(line: string) {
  return /^\[\/?TABLE\]$/iu.test(line);
}

function isTableLikeLine(line: string, tagged: boolean) {
  return tagged || isTableTag(line) || pipeCount(line) >= 2 || (/^\|/.test(line) && /\|$/.test(line));
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
  if (comparable(base) === comparable(addition)) return base;
  return `${base} ${addition}`.replace(/\s+/g, " ").trim();
}

function normalizeRowWidth(row: string[], columns: number) {
  if (row.length < columns) return [...row, ...Array.from({ length: columns - row.length }, () => "")];
  if (row.length > columns) return [...row.slice(0, columns - 1), row.slice(columns - 1).filter(Boolean).join(" ")];
  return [...row];
}

function mergeRows(base: string[], continuation: string[], columns: number) {
  const merged = normalizeRowWidth(base, columns);
  continuation.forEach((cell, index) => {
    if (!cell) return;
    const target = Math.min(index, columns - 1);
    merged[target] = appendCell(merged[target] ?? "", cell);
  });
  return merged;
}

function headerTokenCount(row: string[]) {
  const text = comparable(row.join(" "));
  return [
    "stt", "ho va ten", "noi dung", "linh vuc", "co quan cong tac", "chuc danh",
    "dat", "khong dat", "nhan xet", "yeu cau giai trinh",
  ].filter((token) => text.includes(token)).length;
}

function inferHeaderRows(rows: string[][]) {
  const first = comparable(rows[0]?.[0] ?? "");
  return first === "stt" || first === "so thu tu" || headerTokenCount(rows[0] ?? []) >= 2 ? 1 : 0;
}

function inferFirstColumn(rows: string[][], headerRows: number): OcrTableFirstColumn {
  const first = comparable(rows[0]?.[0] ?? "");
  if (first === "stt" || first === "so thu tu") return "index";
  if (/^mau so\s+\d+/u.test(first)) return "label";
  const body = rows.slice(headerRows).map((row) => row[0]?.trim() ?? "").filter(Boolean);
  const indexed = body.filter((value) => /^(?:\d+|\.{2,}|…+)$/u.test(value)).length;
  return body.length >= 2 && indexed / body.length >= 0.6 ? "index" : "auto";
}

function moveTrailingCheckboxes(row: string[], headers: string[]) {
  if (!row[1]) return row;
  const normalized = headers.map(comparable);
  const passColumn = normalized.findIndex((value) => value === "dat");
  const failColumn = normalized.findIndex((value) => value === "khong dat");
  if (passColumn < 0 || failColumn < 0 || row[passColumn] || row[failColumn]) return row;
  const matches = row[1].match(/(?:□|☐|☑|✓|✔)/gu) ?? [];
  if (matches.length < 2) return row;
  const [pass = "□", fail = "□"] = matches;
  const next = [...row];
  next[1] = row[1].replace(/(?:\s*(?:□|☐|☑|✓|✔)){2,}\s*$/u, "").trim();
  next[passColumn] = pass;
  next[failColumn] = fail;
  return next;
}

function buildTable(rawLines: string[]) {
  const rows: string[][] = [];
  let separatorColumns = 0;
  let tagged = false;

  for (const raw of rawLines) {
    const line = raw.trim();
    if (/^\[TABLE\]$/iu.test(line)) { tagged = true; continue; }
    if (/^\[\/TABLE\]$/iu.test(line)) { tagged = false; continue; }
    const cells = parsePipeCells(line);
    if (!cells) {
      if (tagged && rows.length && !isFillerOnly(line)) {
        const last = rows[rows.length - 1];
        if (last) last[last.length - 1] = appendCell(last[last.length - 1] ?? "", line);
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
      const previous = rows[rows.length - 1];
      if (previous) {
        const continuation = cells.filter((cell, index) => !separatorMask[index] && cell);
        const expected = Math.max(separatorColumns, previous.length + continuation.length);
        continuation.forEach((cell) => {
          if (previous.length < expected) previous.push(cell);
          else previous[previous.length - 1] = appendCell(previous[previous.length - 1] ?? "", cell);
        });
      }
      continue;
    }
    rows.push(cells);
  }

  if (rows.length < 2) return null;
  const columns = separatorColumns >= 2
    ? Math.min(10, separatorColumns)
    : Math.max(2, Math.min(10, ...rows.map((row) => row.length)));
  const normalized = rows.map((row) => normalizeRowWidth(row, columns));
  const merged: string[][] = [];

  for (const row of normalized) {
    const previous = merged[merged.length - 1];
    const key = comparable(row[0] ?? "");
    const previousKey = comparable(previous?.[0] ?? "");
    if (previous && (!key || (key === previousKey && key))) {
      merged[merged.length - 1] = mergeRows(previous, row, columns);
    } else {
      merged.push(row);
    }
  }

  const headerRows = inferHeaderRows(merged);
  const finalRows = headerRows
    ? merged.map((row, index) => index < headerRows ? row : moveTrailingCheckboxes(row, merged[0] ?? []))
    : merged;

  return {
    kind: "table" as const,
    rows: finalRows,
    headerRows,
    columnCount: columns,
    firstColumn: inferFirstColumn(finalRows, headerRows),
  };
}

function parseField(line: string) {
  if (isFillerOnly(line) || line.includes("|")) return null;
  const match = line.match(/^(.*?)(?:\.{5,}|…{2,}|_{5,})(.*)$/u);
  const label = match?.[1]?.trim() ?? "";
  if (!label || (label.match(/\p{L}/gu)?.length ?? 0) < 3) return null;
  const rawValue = match?.[2]?.trim() ?? "";
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
    previous.text = appendCell(previous.text, cleaned);
  } else {
    blocks.push({ kind: "paragraph", text: cleaned });
  }
}

export function buildOcrPreviewBlocks(value: string): OcrPreviewBlock[] {
  const lines = normalize(value).split("\n").map((line) => line.trim()).filter(Boolean);
  const blocks: OcrPreviewBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    if (isTableTag(line) || parsePipeCells(line)) {
      const tableLines: string[] = [];
      let cursor = index;
      let tagged = /^\[TABLE\]$/iu.test(line);
      while (cursor < lines.length) {
        const candidate = lines[cursor] ?? "";
        if (!isTableLikeLine(candidate, tagged)) break;
        tableLines.push(candidate);
        if (/^\[TABLE\]$/iu.test(candidate)) tagged = true;
        if (/^\[\/TABLE\]$/iu.test(candidate)) { cursor += 1; break; }
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
      const row = parseFormRow(lines[formCursor] ?? "");
      if (!row) break;
      formRows.push(row);
      formCursor += 1;
    }
    if (formRows.length >= 2) {
      blocks.push({ kind: "table", rows: formRows, headerRows: 0, columnCount: 2, firstColumn: "label" });
      index = formCursor - 1;
      continue;
    }

    if (isFillerOnly(line)) continue;
    const checkbox = line.match(/^(□|☐|☑|✓|✔|\[\s?[xX]?\s?\])\s*(.+)$/u);
    if (checkbox) {
      blocks.push({ kind: "checkbox", checked: /(?:☑|✓|✔|x)/iu.test(checkbox[1] ?? ""), text: checkbox[2]?.trim() ?? "" });
      continue;
    }

    const field = parseField(line);
    if (field) { blocks.push({ kind: "field", ...field }); continue; }
    if (/^Ghi chú\s*:/iu.test(line)) { blocks.push({ kind: "note", text: line }); continue; }
    if (/^Điều\s+\d+[a-z]?\s*[.:-]/iu.test(line)) { blocks.push({ kind: "article", text: line }); continue; }
    if (/^(?:Mẫu\s+số\s+\d+|Số\s*:|Hà Nội,\s*ngày|Kèm theo Thông tư)/iu.test(line)) {
      blocks.push({ kind: "heading", text: line, level: 3 });
      continue;
    }
    if (isPrimaryTitle(line)) { blocks.push({ kind: "title", text: line }); continue; }

    const level = headingLevel(line);
    if (level) { blocks.push({ kind: "heading", text: line, level: level as 2 | 3 }); continue; }
    const list = line.match(/^((?:\d+|[a-zđ]|[ivxlcdm]+)[.)])\s+(.+)$/iu);
    if (list) {
      blocks.push({ kind: "list", marker: list[1] ?? "", text: list[2]?.trim() ?? "" });
      continue;
    }
    appendParagraph(blocks, line);
  }

  return blocks;
}
