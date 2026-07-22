export type OcrPreviewBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string; level: 2 | 3 }
  | { kind: "article"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; marker: string; text: string }
  | { kind: "checkbox"; checked: boolean; text: string }
  | { kind: "field"; label: string; value: string }
  | { kind: "note"; text: string }
  | { kind: "table"; rows: Array<[string, string]> };

function normalize(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
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
    /^(?:THÔNG TƯ|NGHỊ ĐỊNH|NGHỊ QUYẾT|QUYẾT ĐỊNH|LUẬT)$/iu.test(line) ||
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

function parseMarkdownRow(line: string): [string, string] | null {
  if (!/^\s*\|/.test(line)) return null;
  const cells = line
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
  if (cells.length < 2 || cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  return [cells[0], cells.slice(1).join(" ")];
}

function parseFormRow(line: string): [string, string] | null {
  const match = line.match(/^Mẫu\s+số\s+(\d{1,3})\s*(?:[|:–—-]\s*)?(.+)$/iu);
  if (!match) return null;
  return [`Mẫu số ${match[1].padStart(2, "0")}`, match[2].trim()];
}

function parseField(line: string) {
  const match = line.match(/^(.*?)(?:\.{5,}|…{2,}|_{5,})(.*)$/u);
  if (!match || !match[1].trim()) return null;
  return { label: match[1].trim(), value: match[2].trim() };
}

function appendParagraph(blocks: OcrPreviewBlock[], text: string) {
  const previous = blocks[blocks.length - 1];
  if (previous?.kind === "paragraph" && !/[.;:!?]$/u.test(previous.text)) {
    previous.text = `${previous.text} ${text}`.replace(/\s+/g, " ").trim();
    return;
  }
  blocks.push({ kind: "paragraph", text });
}

export function buildOcrPreviewBlocks(value: string): OcrPreviewBlock[] {
  const lines = normalize(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const blocks: OcrPreviewBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const tableRows: Array<[string, string]> = [];
    let cursor = index;
    while (cursor < lines.length) {
      const row = parseMarkdownRow(lines[cursor]) ?? parseFormRow(lines[cursor]);
      if (!row) break;
      tableRows.push(row);
      cursor += 1;
    }
    if (tableRows.length >= 2) {
      blocks.push({ kind: "table", rows: tableRows });
      index = cursor - 1;
      continue;
    }

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
