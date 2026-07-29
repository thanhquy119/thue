export const OCR_REQUEST_INTERVAL_MS = 8_000;
export const OCR_PAGES_PER_RUN = 18;
const RENDER_WIDTH = 1_600;
const OCR_TIMEOUT_MS = 45_000;
const DEFAULT_OCR_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_QUOTA_RETRY_MS = 65_000;

type GeminiPayload = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }>;
  error?: { message?: unknown };
};

type ScreenshotPage = { data: Uint8Array | Buffer };

export type TransferOcrPage = {
  page: number;
  text: string;
};

export type TransferOcrBatch = {
  pages: TransferOcrPage[];
  totalPages: number;
  processedThrough: number;
  complete: boolean;
};

export class TransferOcrRateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs = DEFAULT_QUOTA_RETRY_MS) {
    super(message);
    this.name = "TransferOcrRateLimitError";
    this.retryAfterMs = Math.max(15_000, retryAfterMs);
  }
}

function normalizeText(value: string) {
  return value
    .replace(/```(?:text)?/giu, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function apiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

function ocrModel() {
  return process.env.OCR_GEMINI_MODEL?.trim() || DEFAULT_OCR_MODEL;
}

function requestIntervalMs() {
  const testValue = Number(process.env.TRANSFER_OCR_TEST_INTERVAL_MS);
  return Number.isFinite(testValue) && testValue >= 0
    ? testValue
    : OCR_REQUEST_INTERVAL_MS;
}

function quotaRetryMs(response: Response, message: string) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.ceil(retryAfter * 1_000) + 1_500;
  const seconds = [...message.matchAll(/retry(?:\s+in|Delay)?[^\d]*(\d+(?:\.\d+)?)s/giu)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  return seconds.length ? Math.ceil(Math.max(...seconds) * 1_000) + 1_500 : DEFAULT_QUOTA_RETRY_MS;
}

async function wait(ms: number) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ocrImage(image: Buffer, page: number, totalPages: number) {
  if (!apiKey()) throw new Error("Gemini chưa được cấu hình cho OCR PDF scan.");
  const model = ocrModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey(),
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text:
                "Bạn là bộ OCR tiếng Việt. Chép trung thực nội dung nhìn thấy trong ảnh tài liệu, theo đúng thứ tự đọc. Bỏ watermark, số trang đứng riêng, khung và yếu tố trang trí. Giữ tiêu đề, bảng, danh sách, dấu câu và xuống dòng hợp lý. Không tự bổ sung nội dung; chỗ không chắc ghi [không đọc rõ].",
            }],
          },
          contents: [{
            role: "user",
            parts: [
              { inline_data: { mime_type: "image/png", data: image.toString("base64") } },
              { text: `OCR trang ${page}/${totalPages}. Chỉ trả về phần chữ, không Markdown và không giải thích.` },
            ],
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 8_192 },
        }),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as GeminiPayload;
    if (!response.ok) {
      const message = typeof payload.error?.message === "string" ? payload.error.message : `Gemini trả lỗi ${response.status}.`;
      if (response.status === 429 || /quota|rate limit|resource exhausted|too many requests/iu.test(message)) {
        throw new TransferOcrRateLimitError(
          `OCR đang tạm nghỉ để bảo vệ hạn mức: ${message}`,
          quotaRetryMs(response, message),
        );
      }
      throw new Error(`OCR trang ${page}/${totalPages} thất bại: ${message}`);
    }
    const text = normalizeText(
      (payload.candidates?.[0]?.content?.parts ?? [])
        .filter((part) => part.thought !== true && typeof part.text === "string")
        .map((part) => part.text as string)
        .join("\n"),
    );
    if (!text) throw new Error(`Không OCR được trang ${page}/${totalPages}.`);
    return text;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`OCR trang ${page}/${totalPages} quá thời gian.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function ocrTransferredPdfBatch(
  buffer: Buffer,
  options: {
    startPage?: number;
    maxPages?: number;
    onPage?: (page: TransferOcrPage, totalPages: number) => Promise<void> | void;
  } = {},
): Promise<TransferOcrBatch> {
  const [{ PDFParse }, { CanvasFactory }] = await Promise.all([
    import("pdf-parse"),
    import("pdf-parse/worker"),
  ]);
  const parser = new PDFParse({ data: Uint8Array.from(buffer), CanvasFactory });
  let totalPages = 0;
  let pages: ScreenshotPage[] = [];
  const requestedStart = Math.max(1, Math.floor(options.startPage ?? 1));
  const maxPages = Math.max(1, Math.floor(options.maxPages ?? OCR_PAGES_PER_RUN));
  let startPage = requestedStart;
  let endPage = requestedStart - 1;
  try {
    const info = await parser.getInfo();
    totalPages = info.total;
    if (totalPages <= 0) throw new Error("PDF scan không xác định được tổng số trang.");
    startPage = Math.min(requestedStart, totalPages + 1);
    if (startPage > totalPages) {
      return { pages: [], totalPages, processedThrough: totalPages, complete: true };
    }
    endPage = Math.min(totalPages, startPage + maxPages - 1);
    const screenshots = await parser.getScreenshot({
      desiredWidth: RENDER_WIDTH,
      first: endPage,
      imageDataUrl: false,
      imageBuffer: true,
    });
    const rendered = screenshots.pages as ScreenshotPage[];
    pages = rendered.slice(startPage - 1, endPage);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
  const expectedPages = endPage - startPage + 1;
  if (pages.length !== expectedPages) {
    throw new Error(`Không render đủ trang PDF để OCR (${pages.length}/${expectedPages} trang của lượt này).`);
  }

  const completed: TransferOcrPage[] = [];
  let lastRequestStartedAt = 0;
  for (let index = 0; index < pages.length; index += 1) {
    const elapsed = Date.now() - lastRequestStartedAt;
    if (lastRequestStartedAt > 0) await wait(Math.max(0, requestIntervalMs() - elapsed));
    lastRequestStartedAt = Date.now();
    const pageNumber = startPage + index;
    const image = Buffer.from(pages[index].data);
    pages[index] = { data: new Uint8Array() };
    const page = { page: pageNumber, text: await ocrImage(image, pageNumber, totalPages) };
    completed.push(page);
    await options.onPage?.(page, totalPages);
  }

  const processedThrough = completed.at(-1)?.page ?? startPage - 1;
  return {
    pages: completed,
    totalPages,
    processedThrough,
    complete: processedThrough >= totalPages,
  };
}

export async function ocrTransferredPdf(buffer: Buffer) {
  const batch = await ocrTransferredPdfBatch(buffer, { maxPages: Number.MAX_SAFE_INTEGER });
  return {
    text: normalizeText(batch.pages.map((page) => page.text).join("\n\n")),
    totalPages: batch.totalPages,
    processedPages: batch.processedThrough,
    truncated: !batch.complete,
  };
}
