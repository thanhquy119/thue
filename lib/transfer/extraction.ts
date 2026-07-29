import JSZip from "jszip";
import WordExtractor from "word-extractor";
import { ocrTransferredPdf } from "./pdf-ocr";

export const TRANSFER_EXTRACTION_VERSION = 2;

// Private-use markers retain table boundaries through the plain-text legal reader.
// The client upgrades these invisible markers into an accessible responsive grid.
const TABLE_CELL_MARKER = "\uE000";
const TABLE_ROW_MARKER = "\uE001";
const TABLE_START_MARKER = "\uE002";
const TABLE_END_MARKER = "\uE003";

export type TransferExtraction = {
  text: string;
  method: string;
  totalPages: number;
  processedPages: number;
  partial: boolean;
  warnings: string[];
};

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
    return `${previousIsTable ? "" : TABLE_START_MARKER}${cells.join(TABLE_CELL_MARKER)}${TABLE_ROW_MARKER}${nextIsTable ? "" : TABLE_END_MARKER}`;
  });
  return normalized.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

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

async function extractPdf(buffer: Buffer): Promise<TransferExtraction> {
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

  const ocr = await ocrTransferredPdf(buffer);
  return {
    text: ocr.text,
    method: "pdf_ocr",
    totalPages: ocr.totalPages,
    processedPages: ocr.processedPages,
    partial: ocr.truncated,
    warnings: ocr.truncated
      ? [`PDF scan có ${ocr.totalPages} trang; phiên bản đầu đã OCR ${ocr.processedPages} trang đầu để bảo vệ thời gian và chi phí xử lý.`]
      : ["PDF không có lớp chữ nên hệ thống đã OCR từ ảnh trang."],
  };
}

export async function extractTransferredFile(buffer: Buffer, filename: string, contentType: string): Promise<TransferExtraction> {
  const lower = filename.toLocaleLowerCase("en");
  if (contentType.includes("pdf") || lower.endsWith(".pdf") || buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return extractPdf(buffer);
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
