import { geminiModel, hasGeminiConfig } from "../legal/gemini";

const OCR_CONCURRENCY = 4;
const RENDER_WIDTH = 1_600;
const OCR_TIMEOUT_MS = 45_000;

// Giới hạn cũ từng dùng `const MAX_PAGES = 6` và
// `Math.min(totalPages, MAX_PAGES)`. PDF scan bây giờ phải xử lý đủ mọi trang.

type GeminiPayload = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }>;
  error?: { message?: unknown };
};

type ScreenshotPage = { data: Uint8Array | Buffer };

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

async function ocrImage(image: Buffer, page: number, totalPages: number) {
  if (!hasGeminiConfig()) throw new Error("Gemini chưa được cấu hình cho OCR PDF scan.");
  const model = process.env.OCR_GEMINI_MODEL?.trim() || geminiModel();
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

export async function ocrTransferredPdf(buffer: Buffer) {
  const [{ PDFParse }, { CanvasFactory }] = await Promise.all([
    import("pdf-parse"),
    import("pdf-parse/worker"),
  ]);
  const parser = new PDFParse({ data: Uint8Array.from(buffer), CanvasFactory });
  let totalPages = 0;
  let pages: ScreenshotPage[] = [];
  try {
    const info = await parser.getInfo();
    totalPages = info.total;
    const screenshots = await parser.getScreenshot({
      desiredWidth: RENDER_WIDTH,
      first: totalPages,
      imageDataUrl: false,
      imageBuffer: true,
    });
    pages = screenshots.pages as ScreenshotPage[];
  } finally {
    await parser.destroy().catch(() => undefined);
  }
  if (!pages.length) throw new Error("Không render được PDF scan để OCR.");
  if (pages.length !== totalPages) {
    throw new Error(`Không render đủ trang PDF để OCR (${pages.length}/${totalPages}).`);
  }

  const texts = new Array<string>(pages.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < pages.length) {
      const index = cursor;
      cursor += 1;
      const image = Buffer.from(pages[index].data);
      pages[index] = { data: new Uint8Array() };
      texts[index] = await ocrImage(image, index + 1, totalPages);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(OCR_CONCURRENCY, pages.length) },
    () => worker(),
  ));

  return {
    text: normalizeText(texts.join("\n\n")),
    totalPages,
    processedPages: totalPages,
    truncated: false,
  };
}
