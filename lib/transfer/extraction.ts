import * as XLSX from "@e965/xlsx";
import JSZip from "jszip";
import WordExtractor from "word-extractor";
import { normalizeTransferredText } from "./structured-text.ts";

export { normalizeTransferredText } from "./structured-text.ts";
export const TRANSFER_EXTRACTION_VERSION = 4;

const MAX_SPREADSHEET_SHEETS = 100;
const MAX_SPREADSHEET_ROWS_PER_SHEET = 50_000;
const MAX_SPREADSHEET_COLUMNS = 500;
const MAX_SPREADSHEET_CELLS = 250_000;
const MAX_SPREADSHEET_CHARACTERS = 2_000_000;
const SPREADSHEET_EXTENSION = /\.(?:xlsx|xls|xlsm|xlsb|xltx|xltm|ods|csv|tsv)$/iu;
const SPREADSHEET_CONTENT_TYPE = /(?:spreadsheet|excel|csv|tab-separated-values)/iu;

export type TransferExtraction = {
  text: string;
  method: string;
  totalPages: number;
  processedPages: number;
  partial: boolean;
  warnings: string[];
};

export type TransferExtractionOptions = {
  deferPdfOcr?: boolean;
};

function decodeHtml(value: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (_match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLocaleLowerCase("en")] ?? `&${entity};`;
  });
}

function htmlToText(html: string) {
  return normalizeTransferredText(
    decodeHtml(
      html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
        .replace(/<\/(?:td|th)>/giu, "\t")
        .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)>/giu, "\n")
        .replace(/<[^>]+>/gu, " "),
    ),
  );
}

function docxXmlToText(xml: string) {
  const tokens: string[] = [];
  const pattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?\s*>|<w:(?:br|cr)\b[^>]*\/?\s*>|<\/w:(?:p|tr)>|<\/w:tc>/giu;
  for (const match of xml.matchAll(pattern)) {
    const token = match[0];
    if (/^<w:t\b/iu.test(token)) tokens.push(decodeHtml(match[1] ?? ""));
    else if (/^<w:tab\b/iu.test(token) || /^<\/w:tc>/iu.test(token)) tokens.push("\t");
    else tokens.push("\n");
  }
  return normalizeTransferredText(tokens.join(""));
}

async function extractDocx(buffer: Buffer) {
  const mammoth = await import("mammoth");
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = normalizeTransferredText(result.value);
    if (text.length >= 40) return text;
  } catch {
    // Fall back to reading the DOCX XML directly.
  }
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: false, createFolders: true });
  const entry = Object.values(zip.files).find(
    (item) => item.name.replace(/\\/gu, "/").replace(/^\/+/, "") === "word/document.xml",
  );
  if (!entry || entry.dir) throw new Error("Không tìm thấy nội dung chính trong DOCX.");
  return docxXmlToText(await entry.async("string"));
}

function spreadsheetCellText(value: unknown) {
  if (value == null) return "";
  if (value instanceof Date) return value.toLocaleString("vi-VN");
  return String(value)
    .replace(/[\uE000-\uE003]/gu, " ")
    .replace(/\r\n?|\n/gu, " / ")
    .replace(/\t/gu, " ")
    .replace(/[ ]{2,}/gu, " ")
    .trim()
    .slice(0, 2_000);
}

function extractSpreadsheet(buffer: Buffer): TransferExtraction {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
      cellFormula: false,
      cellHTML: false,
      cellNF: false,
      cellStyles: false,
      dense: true,
      sheetRows: MAX_SPREADSHEET_ROWS_PER_SHEET,
    });
  } catch {
    throw new Error("Không đọc được cấu trúc bảng tính. File có thể bị hỏng hoặc được đặt mật khẩu.");
  }

  const warnings: string[] = [];
  const output: string[] = [];
  let characters = 0;
  let cells = 0;
  let truncated = false;
  const sheetNames = workbook.SheetNames.slice(0, MAX_SPREADSHEET_SHEETS);
  if (workbook.SheetNames.length > sheetNames.length) {
    warnings.push(`Chỉ trích ${MAX_SPREADSHEET_SHEETS} trang tính đầu tiên.`);
  }

  sheetLoop:
  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    }) as unknown[][];
    const lines = [`Trang tính: ${spreadsheetCellText(sheetName) || "Không tên"}`];
    if (rows.length >= MAX_SPREADSHEET_ROWS_PER_SHEET) {
      warnings.push(`Trang tính “${sheetName}” được giới hạn ở ${MAX_SPREADSHEET_ROWS_PER_SHEET.toLocaleString("vi-VN")} dòng.`);
    }

    for (const row of rows) {
      const values = Array.from({ length: Math.min(row.length, MAX_SPREADSHEET_COLUMNS) }, (_, index) =>
        spreadsheetCellText(row[index]),
      );
      while (values.length && !values.at(-1)) values.pop();
      if (!values.some(Boolean)) continue;
      cells += values.filter(Boolean).length;
      if (cells > MAX_SPREADSHEET_CELLS) {
        truncated = true;
        break sheetLoop;
      }
      const line = values.join("\t");
      if (characters + line.length + 1 > MAX_SPREADSHEET_CHARACTERS) {
        truncated = true;
        break sheetLoop;
      }
      lines.push(line);
      characters += line.length + 1;
    }

    if (lines.length > 1) output.push(lines.join("\n"));
  }

  if (truncated) {
    warnings.push("Bảng tính quá lớn nên nội dung nghe được giới hạn để bảo đảm bộ nhớ và tốc độ xử lý.");
  }
  const text = normalizeTransferredText(output.join("\n\n"));
  if (text.length < 2) throw new Error("Bảng tính không có ô dữ liệu nào để đọc.");
  return {
    text,
    method: "spreadsheet",
    totalPages: sheetNames.length,
    processedPages: sheetNames.length,
    partial: false,
    warnings,
  };
}

async function extractPdf(buffer: Buffer, options: TransferExtractionOptions): Promise<TransferExtraction> {
  const [{ PDFParse }, { CanvasFactory }] = await Promise.all([
    import("pdf-parse"),
    import("pdf-parse/worker"),
  ]);
  const parser = new PDFParse({ data: Uint8Array.from(buffer), CanvasFactory });
  let totalPages = 0;
  let text = "";
  try {
    totalPages = (await parser.getInfo()).total;
    text = normalizeTransferredText((await parser.getText()).text.replace(/-- \d+ of \d+ --/gu, " "));
  } finally {
    await parser.destroy().catch(() => undefined);
  }

  const readable = text.length >= Math.max(120, totalPages * 35);
  if (readable) {
    return {
      text,
      method: "pdf_text",
      totalPages,
      processedPages: totalPages,
      partial: false,
      warnings: [],
    };
  }

  if (options.deferPdfOcr) {
    return {
      text: "",
      method: "pdf_ocr",
      totalPages,
      processedPages: 0,
      partial: true,
      warnings: [],
    };
  }

  const { ocrTransferredPdf } = await import("./pdf-ocr.ts");
  const ocr = await ocrTransferredPdf(buffer);
  if (ocr.processedPages !== ocr.totalPages || ocr.truncated) {
    throw new Error(`PDF chưa được OCR đầy đủ (${ocr.processedPages}/${ocr.totalPages} trang).`);
  }
  return {
    text: ocr.text,
    method: "pdf_ocr",
    totalPages: ocr.totalPages,
    processedPages: ocr.processedPages,
    partial: false,
    warnings: [],
  };
}

export async function extractTransferredFile(
  buffer: Buffer,
  filename: string,
  contentType: string,
  options: TransferExtractionOptions = {},
): Promise<TransferExtraction> {
  const lower = filename.toLocaleLowerCase("en");
  if (contentType.includes("pdf") || lower.endsWith(".pdf") || buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return extractPdf(buffer, options);
  }
  if (SPREADSHEET_CONTENT_TYPE.test(contentType) || SPREADSHEET_EXTENSION.test(lower)) {
    return extractSpreadsheet(buffer);
  }
  if (contentType.includes("wordprocessingml") || lower.endsWith(".docx")) {
    return { text: await extractDocx(buffer), method: "docx", totalPages: 0, processedPages: 0, partial: false, warnings: [] };
  }
  if (contentType.includes("msword") || lower.endsWith(".doc")) {
    const extractor = new WordExtractor();
    const document = await extractor.extract(buffer);
    const text = normalizeTransferredText([document.getBody(), document.getTextboxes({ includeHeadersAndFooters: false })].filter(Boolean).join("\n\n"));
    return { text, method: "doc", totalPages: 0, processedPages: 0, partial: false, warnings: [] };
  }
  if (contentType.includes("html") || lower.endsWith(".html") || lower.endsWith(".htm")) {
    return { text: htmlToText(buffer.toString("utf8")), method: "html", totalPages: 0, processedPages: 0, partial: false, warnings: [] };
  }
  if (contentType.startsWith("text/") || /\.(?:txt|md|rtf)$/iu.test(lower)) {
    return { text: normalizeTransferredText(buffer.toString("utf8")), method: "plain_text", totalPages: 0, processedPages: 0, partial: false, warnings: [] };
  }
  throw new Error("Định dạng file này chưa được hỗ trợ để chuyển thành nội dung nghe.");
}
