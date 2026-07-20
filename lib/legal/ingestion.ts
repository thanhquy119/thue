import { createHash } from "node:crypto";
import { get as httpsGet } from "node:https";
import WordExtractor from "word-extractor";

const MAX_SOURCE_BYTES = 18_000_000;
const ALLOWED_HOSTS = new Set([
  "congbao.chinhphu.vn",
  "vanban.chinhphu.vn",
  "datafiles.chinhphu.vn",
  "g7.cdnchinhphu.vn",
  "congbaocdn.chinhphu.vn",
  "xaydungchinhsach.chinhphu.vn",
  "xdcs.cdnchinhphu.vn",
  "mof.gov.vn",
  "www.mof.gov.vn",
  "vbpq.mof.gov.vn",
  "gdt.gov.vn",
  "www.gdt.gov.vn",
  "moj.gov.vn",
  "www.moj.gov.vn",
  "vbpl.vn",
  "www.vbpl.vn",
  "pbgdpl.cantho.gov.vn",
]);
const ALLOWED_ROOT_DOMAINS = ["vbpl.vn", "chinhphu.vn", "mof.gov.vn", "gdt.gov.vn", "moj.gov.vn"];
const OFFICIAL_CDN_TLS_FALLBACK = new Set(["g7.cdnchinhphu.vn", "congbaocdn.chinhphu.vn"]);

export type ExtractedSource = {
  sourceUrl: string | null;
  mimeType: string;
  fileName: string | null;
  officialText: string;
  sha256: string;
  extractionMethod: "html" | "doc" | "docx" | "pdf_text" | "plain_text" | "ocr_required";
  qualityScore: number;
  requiresOcr: boolean;
  metadata: Record<string, unknown>;
};

export type ParsedProvision = {
  provisionType: "preamble" | "chapter" | "section" | "article" | "other";
  identifier: string | null;
  article: string | null;
  heading: string | null;
  officialText: string;
  orderIndex: number;
};

export function isAllowedLegalSource(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLocaleLowerCase("en");
    return (
      url.protocol === "https:" &&
      (ALLOWED_HOSTS.has(host) || ALLOWED_ROOT_DOMAINS.some((root) => host === root || host.endsWith(`.${root}`)))
    );
  } catch {
    return false;
  }
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

function officialAttachmentUrl(html: string, pageUrl: string) {
  const candidates = [...html.matchAll(/(?:href|src)=["']([^"']+\.(?:pdf|docx?)(?:\?[^"']*)?)["']/giu)]
    .map((match) => {
      try {
        return new URL(decodeHtml(match[1]), pageUrl).toString();
      } catch {
        return "";
      }
    })
    .filter((url) => isAllowedLegalSource(url));
  return (
    candidates.find((url) => /\.docx(?:$|\?)/iu.test(url)) ??
    candidates.find((url) => /\.doc(?:$|\?)/iu.test(url)) ??
    candidates.find((url) => /\.pdf(?:$|\?)/iu.test(url)) ??
    candidates[0] ??
    null
  );
}

function scoreText(text: string, method: ExtractedSource["extractionMethod"]) {
  if (method === "ocr_required") return 0.2;
  const lengthScore = Math.min(1, text.length / 8_000);
  const legalMarkers = (text.match(/\b(?:Điều|Chương|Khoản)\s+[0-9IVXLC]+/giu) ?? []).length;
  const markerScore = Math.min(1, legalMarkers / 8);
  const replacementRatio = (text.match(/�/g) ?? []).length / Math.max(1, text.length);
  const base = method === "docx" ? 0.58 : method === "doc" ? 0.56 : method === "pdf_text" ? 0.52 : method === "html" ? 0.42 : 0.5;
  return Math.max(0, Math.min(1, base + lengthScore * 0.2 + markerScore * 0.22 - replacementRatio * 20));
}

async function safeFetch(urlValue: string, redirects = 0): Promise<{ response: Response; buffer: Buffer }> {
  if (!isAllowedLegalSource(urlValue)) throw new Error("URL không thuộc danh sách nguồn pháp luật được phép.");
  if (redirects > 3) throw new Error("Nguồn chuyển hướng quá nhiều lần.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18_000);
  try {
    let response: Response;
    try {
      response = await fetch(urlValue, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "ThueLegalReader/1.0" },
      });
    } catch (error) {
      const cause = error && typeof error === "object" && "cause" in error ? error.cause : error;
      const code = cause && typeof cause === "object" && "code" in cause ? codeFromCause(cause) : null;
      const host = new URL(urlValue).hostname;
      // Keep relaxed TLS pinned to the two official Government CDN hosts only.
      if (OFFICIAL_CDN_TLS_FALLBACK.has(host) && code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
        return fetchOfficialCdn(urlValue, redirects);
      }
      throw error;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Nguồn chuyển hướng không hợp lệ.");
      const next = new URL(location, urlValue).toString();
      return safeFetch(next, redirects + 1);
    }
    if (!response.ok) throw new Error(`Nguồn trả lỗi ${response.status}.`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_SOURCE_BYTES) throw new Error("Tệp nguồn vượt giới hạn 18 MB.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_SOURCE_BYTES) throw new Error("Tệp nguồn vượt giới hạn 18 MB.");
    return { response, buffer };
  } finally {
    clearTimeout(timer);
  }
}

function codeFromCause(cause: object) {
  return "code" in cause && typeof cause.code === "string" ? cause.code : null;
}

async function fetchOfficialCdn(urlValue: string, redirects: number): Promise<{ response: Response; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const request = httpsGet(
      urlValue,
      {
        headers: { "user-agent": "ThueLegalReader/1.0" },
        rejectUnauthorized: false,
      },
      (incoming) => {
        const status = incoming.statusCode ?? 500;
        if (status >= 300 && status < 400) {
          const location = incoming.headers.location;
          incoming.resume();
          if (!location) {
            reject(new Error("Nguồn chuyển hướng không hợp lệ."));
            return;
          }
          safeFetch(new URL(location, urlValue).toString(), redirects + 1).then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          incoming.resume();
          reject(new Error(`Nguồn trả lỗi ${status}.`));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        incoming.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_SOURCE_BYTES) {
            request.destroy(new Error("Tệp nguồn vượt giới hạn 18 MB."));
            return;
          }
          chunks.push(chunk);
        });
        incoming.on("end", () => {
          const headers = new Headers();
          for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
            headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
          }
          const response = new Response(null, { status, headers });
          Object.defineProperty(response, "url", { value: urlValue });
          resolve({ response, buffer: Buffer.concat(chunks) });
        });
        incoming.on("error", reject);
      },
    );
    request.setTimeout(18_000, () => request.destroy(new Error("Nguồn phản hồi quá thời gian.")));
    request.on("error", reject);
  });
}

function filenameFrom(response: Response, sourceUrl: string) {
  const disposition = response.headers.get("content-disposition");
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const simple = disposition?.match(/filename="?([^";]+)"?/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  if (simple) return simple;
  return new URL(sourceUrl).pathname.split("/").pop() || null;
}

async function extractBuffer(
  buffer: Buffer,
  mimeType: string,
  sourceUrl: string | null,
  fileName: string | null,
): Promise<ExtractedSource> {
  let officialText = "";
  let extractionMethod: ExtractedSource["extractionMethod"] = "plain_text";
  let requiresOcr = false;
  const lowerName = fileName?.toLocaleLowerCase("en") ?? "";

  if (mimeType.includes("wordprocessingml") || lowerName.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    officialText = normalizeText(result.value);
    extractionMethod = "docx";
  } else if (mimeType.includes("msword") || lowerName.endsWith(".doc")) {
    const extractor = new WordExtractor();
    const document = await extractor.extract(buffer);
    officialText = normalizeText(document.getBody());
    extractionMethod = "doc";
  } else if (mimeType.includes("pdf") || lowerName.endsWith(".pdf")) {
    const [{ PDFParse }, { CanvasFactory }] = await Promise.all([
      import("pdf-parse"),
      import("pdf-parse/worker"),
    ]);
    const parser = new PDFParse({ data: buffer, CanvasFactory });
    try {
      const result = await parser.getText();
      officialText = normalizeText(result.text.replace(/-- \d+ of \d+ --/g, " "));
    } finally {
      await parser.destroy().catch(() => undefined);
    }
    if (officialText.length < 1_200) {
      extractionMethod = "ocr_required";
      requiresOcr = true;
    } else {
      extractionMethod = "pdf_text";
    }
  } else if (mimeType.includes("html") || lowerName.endsWith(".html") || lowerName.endsWith(".htm")) {
    officialText = htmlToText(buffer.toString("utf8"));
    extractionMethod = "html";
  } else {
    officialText = normalizeText(buffer.toString("utf8"));
    extractionMethod = "plain_text";
  }

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  return {
    sourceUrl,
    mimeType,
    fileName,
    officialText,
    sha256,
    extractionMethod,
    qualityScore: scoreText(officialText, extractionMethod),
    requiresOcr,
    metadata: {
      bytes: buffer.byteLength,
      legalMarkerCount: (officialText.match(/\b(?:Điều|Chương|Khoản)\s+[0-9IVXLC]+/giu) ?? []).length,
      requiresOcr,
    },
  };
}

export async function extractFromUrl(sourceUrl: string) {
  const { response, buffer } = await safeFetch(sourceUrl);
  const mimeType = response.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
  const resolvedUrl = response.url || sourceUrl;
  if (mimeType.includes("html")) {
    const attachmentUrl = officialAttachmentUrl(buffer.toString("utf8"), resolvedUrl);
    if (attachmentUrl) {
      const attachment = await safeFetch(attachmentUrl);
      const attachmentMime = attachment.response.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
      const extracted = await extractBuffer(
        attachment.buffer,
        attachmentMime,
        attachment.response.url || attachmentUrl,
        filenameFrom(attachment.response, attachmentUrl),
      );
      return { ...extracted, metadata: { ...extracted.metadata, landingPageUrl: resolvedUrl } };
    }
  }
  return extractBuffer(buffer, mimeType, resolvedUrl, filenameFrom(response, sourceUrl));
}

export async function extractFromFile(file: File) {
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Tệp tải lên vượt giới hạn 18 MB.");
  return extractBuffer(Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream", null, file.name);
}

export function parseLegalHierarchy(input: string): ParsedProvision[] {
  const text = normalizeText(input);
  if (!text) return [];

  // Keep Điều headings separate from their body. This prevents the UI from
  // rendering "Điều 1" twice and lets numbered clauses stay inside the body.
  const articlePattern = /^\s*Điều\s+(\d+[a-zA-Z]?)\s*[.:]?\s*([^\n]*)$/gimu;
  const articleMatches = [...text.matchAll(articlePattern)];

  if (!articleMatches.length) {
    return [
      {
        provisionType: "other",
        identifier: null,
        article: null,
        heading: null,
        officialText: text,
        orderIndex: 0,
      },
    ];
  }

  const provisions: ParsedProvision[] = [];
  const firstStart = articleMatches[0].index ?? 0;
  const preamble = normalizeText(text.slice(0, firstStart));
  if (preamble) {
    provisions.push({
      provisionType: "preamble",
      identifier: "Phần mở đầu",
      article: null,
      heading: null,
      officialText: preamble,
      orderIndex: 0,
    });
  }

  for (let index = 0; index < articleMatches.length; index += 1) {
    const match = articleMatches[index];
    const headingStart = match.index ?? 0;
    const headingEnd = headingStart + match[0].length;
    const nextStart = articleMatches[index + 1]?.index ?? text.length;
    const body = normalizeText(text.slice(headingEnd, nextStart));
    const article = match[1];
    const heading = match[2]?.trim() || null;

    provisions.push({
      provisionType: "article",
      identifier: `Điều ${article}`,
      article,
      heading,
      officialText: body,
      orderIndex: (index + 1) * 100,
    });
  }

  return provisions;
}

export function slugifyDocument(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}
