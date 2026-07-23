import { createHash } from "node:crypto";
import JSZip from "jszip";
import WordExtractor from "word-extractor";
import { isAllowedLegalSource } from "./ingestion.ts";

const DEFAULT_MAX_DURABLE_SOURCE_BYTES = 100_000_000;

export type DurableExtractedSource = {
  sourceUrl: string;
  sourceBuffer: Buffer;
  mimeType: string;
  fileName: string;
  officialText: string;
  sha256: string;
  extractionMethod: "docx" | "doc" | "pdf_text" | "html" | "plain_text" | "ocr_required";
  qualityScore: number;
  requiresOcr: boolean;
  totalPages: number;
  metadata: Record<string, unknown>;
};

function maximumSourceBytes() {
  const configured = Number(process.env.LEGAL_MAX_SOURCE_BYTES ?? 0);
  return Number.isFinite(configured) && configured >= 1_000_000
    ? Math.floor(configured)
    : DEFAULT_MAX_DURABLE_SOURCE_BYTES;
}

function normalizeText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLocaleLowerCase("en")] ?? `&${entity};`;
  });
}

function htmlToText(html: string) {
  return normalizeText(
    decodeHtml(
      html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function scoreText(text: string, method: DurableExtractedSource["extractionMethod"]) {
  if (method === "ocr_required") return 0.2;
  const lengthScore = Math.min(1, text.length / 8_000);
  const legalMarkers = text.match(/\b(?:Điều|Chương|Khoản|Mục)\s+[0-9IVXLC]+/giu)?.length ?? 0;
  const markerScore = Math.min(1, legalMarkers / 8);
  const replacementRatio = (text.match(/�/g)?.length ?? 0) / Math.max(1, text.length);
  const base = method === "docx"
    ? 0.58
    : method === "doc"
      ? 0.56
      : method === "pdf_text"
        ? 0.52
        : method === "html"
          ? 0.42
          : 0.5;
  return Math.max(0, Math.min(1, base + lengthScore * 0.2 + markerScore * 0.22 - replacementRatio * 20));
}

function textHasUsableLegalStructure(text: string) {
  if (text.length < 1_200) return false;
  const markers = text.match(/\b(?:Điều|Chương|Khoản|Mục)\s+[0-9IVXLC]+/giu)?.length ?? 0;
  const replacementRatio = (text.match(/�/g)?.length ?? 0) / Math.max(1, text.length);
  return replacementRatio <= 0.003 && scoreText(text, "pdf_text") >= 0.54 && (markers >= 2 || text.length >= 5_000);
}

function filenameFrom(response: Response, sourceUrl: string) {
  const disposition = response.headers.get("content-disposition");
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const simple = disposition?.match(/filename="?([^";]+)"?/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  if (simple) return simple;
  return decodeURIComponent(new URL(sourceUrl).pathname.split("/").pop() || "legal-source.bin");
}

function extensionFrom(value: string) {
  return value.toLocaleLowerCase("en").match(/\.([a-z0-9]{2,5})(?:$|\?)/u)?.[1] ?? "";
}

function attachmentCandidates(html: string, pageUrl: string) {
  const candidates = [...html.matchAll(/(?:href|src)=["']([^"']+\.(?:pdf|docx?)(?:\?[^"']*)?)["']/giu)]
    .map((match) => {
      try {
        return new URL(decodeHtml(match[1]), pageUrl).toString();
      } catch {
        return "";
      }
    })
    .filter((url) => url && isAllowedLegalSource(url));
  const priority = (url: string) => {
    const extension = extensionFrom(url);
    return extension === "docx" ? 0 : extension === "doc" ? 1 : extension === "pdf" ? 2 : 3;
  };
  return Array.from(new Set(candidates)).sort((left, right) => priority(left) - priority(right));
}

async function fetchBuffer(urlValue: string, redirects = 0): Promise<{ response: Response; buffer: Buffer; url: string }> {
  if (!isAllowedLegalSource(urlValue)) throw new Error("URL không thuộc danh sách nguồn pháp luật được phép.");
  if (redirects > 4) throw new Error("Nguồn chuyển hướng quá nhiều lần.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(urlValue, {
      redirect: "manual",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "user-agent": "ThueRoDurableIngestion/1.0",
        accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/pdf,text/html,*/*",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Nguồn chuyển hướng không hợp lệ.");
      return fetchBuffer(new URL(location, urlValue).toString(), redirects + 1);
    }
    if (!response.ok) throw new Error(`Nguồn trả lỗi ${response.status}.`);
    const maximum = maximumSourceBytes();
    const announcedLength = Number(response.headers.get("content-length") ?? 0);
    if (announcedLength > maximum) {
      throw new Error(`Tệp nguồn vượt giới hạn nền ${Math.round(maximum / 1_000_000)} MB.`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength < 100) throw new Error("Tệp nguồn quá nhỏ hoặc không hợp lệ.");
    if (buffer.byteLength > maximum) {
      throw new Error(`Tệp nguồn vượt giới hạn nền ${Math.round(maximum / 1_000_000)} MB.`);
    }
    return { response, buffer, url: response.url || urlValue };
  } finally {
    clearTimeout(timer);
  }
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
  return normalizeText(tokens.join(""));
}

async function extractDocx(buffer: Buffer) {
  const mammoth = await import("mammoth");
  try {
    const extracted = await mammoth.extractRawText({ buffer });
    const text = normalizeText(extracted.value);
    if (text.length >= 200) return { text, repairedPath: false };
  } catch {
    // Một số DOCX ký số dùng dấu gạch ngược trong đường dẫn ZIP.
  }
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: false, createFolders: true });
  const entry = Object.values(zip.files).find(
    (item) => item.name.replace(/\\/g, "/").replace(/^\/+/, "") === "word/document.xml",
  );
  if (!entry || entry.dir) throw new Error("Không tìm thấy nội dung chính trong DOCX.");
  const text = docxXmlToText(await entry.async("string"));
  if (text.length < 200) throw new Error("DOCX không chứa đủ nội dung chữ.");
  return { text, repairedPath: true };
}

async function extractDownloadedSource(sourceUrl: string, response: Response, buffer: Buffer): Promise<DurableExtractedSource> {
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
  const fileName = filenameFrom(response, sourceUrl);
  const lowerName = fileName.toLocaleLowerCase("en");
  let officialText = "";
  let extractionMethod: DurableExtractedSource["extractionMethod"] = "plain_text";
  let requiresOcr = false;
  let totalPages = 0;
  const metadata: Record<string, unknown> = { bytes: buffer.byteLength };

  if (mimeType.includes("wordprocessingml") || lowerName.endsWith(".docx")) {
    const result = await extractDocx(buffer);
    officialText = result.text;
    extractionMethod = "docx";
    metadata.repairedDocxPath = result.repairedPath;
  } else if (mimeType.includes("msword") || lowerName.endsWith(".doc")) {
    const extractor = new WordExtractor();
    const document = await extractor.extract(buffer);
    officialText = normalizeText(document.getBody());
    extractionMethod = "doc";
  } else if (mimeType.includes("pdf") || lowerName.endsWith(".pdf") || buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    const [{ PDFParse }, { CanvasFactory }] = await Promise.all([
      import("pdf-parse"),
      import("pdf-parse/worker"),
    ]);
    const parser = new PDFParse({ data: Uint8Array.from(buffer), CanvasFactory });
    try {
      const info = await parser.getInfo();
      totalPages = info.total;
      const result = await parser.getText();
      officialText = normalizeText(result.text.replace(/-- \d+ of \d+ --/g, " "));
    } finally {
      await parser.destroy().catch(() => undefined);
    }
    if (textHasUsableLegalStructure(officialText)) extractionMethod = "pdf_text";
    else {
      extractionMethod = "ocr_required";
      requiresOcr = true;
    }
  } else if (mimeType.includes("html") || lowerName.endsWith(".html") || lowerName.endsWith(".htm")) {
    officialText = htmlToText(buffer.toString("utf8"));
    extractionMethod = "html";
  } else {
    officialText = normalizeText(buffer.toString("utf8"));
  }

  metadata.totalPages = totalPages;
  metadata.legalMarkerCount = officialText.match(/\b(?:Điều|Chương|Khoản|Mục)\s+[0-9IVXLC]+/giu)?.length ?? 0;
  metadata.requiresOcr = requiresOcr;
  return {
    sourceUrl,
    sourceBuffer: buffer,
    mimeType,
    fileName,
    officialText,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    extractionMethod,
    qualityScore: scoreText(officialText, extractionMethod),
    requiresOcr,
    totalPages,
    metadata,
  };
}

export async function extractDurableLegalSource(sourceUrl: string): Promise<DurableExtractedSource> {
  const source = await fetchBuffer(sourceUrl);
  const mimeType = source.response.headers.get("content-type")?.split(";")[0]?.trim() || "";
  if (mimeType.includes("html")) {
    const html = source.buffer.toString("utf8");
    const candidates = attachmentCandidates(html, source.url);
    let lastError: Error | null = null;
    for (const candidate of candidates) {
      try {
        const attachment = await fetchBuffer(candidate);
        const extracted = await extractDownloadedSource(attachment.url, attachment.response, attachment.buffer);
        extracted.metadata.landingPageUrl = source.url;
        return extracted;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Không tải được tệp đính kèm.");
      }
    }
    if (lastError && !htmlToText(html)) throw lastError;
  }
  return extractDownloadedSource(source.url, source.response, source.buffer);
}

export function sourceFileExtension(source: DurableExtractedSource) {
  const fromName = extensionFrom(source.fileName);
  if (fromName) return fromName;
  if (source.mimeType.includes("wordprocessingml")) return "docx";
  if (source.mimeType.includes("msword")) return "doc";
  if (source.mimeType.includes("pdf")) return "pdf";
  if (source.mimeType.includes("html")) return "html";
  return "bin";
}
