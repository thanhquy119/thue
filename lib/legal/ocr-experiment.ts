import { geminiModel, hasGeminiConfig } from "./gemini";
import { isAllowedLegalSource } from "./ingestion";

const MAX_SOURCE_BYTES = 18_000_000;
const DEFAULT_MAX_PAGES = 3;
const ABSOLUTE_MAX_PAGES = 6;
const RENDER_WIDTH = 1_800;

export type OcrDraft = {
  text: string;
  score: number;
  pass: "literal" | "structure" | "consensus" | "embedded";
};

export type OcrPageComparison = {
  page: number;
  similarity: number;
  chosenPass: OcrDraft["pass"];
  chosenScore: number;
  literalScore: number;
  structureScore: number;
  consensusScore: number | null;
  text: string;
  notices?: string[];
};

export type OcrExperimentResult = {
  sourceUrl: string;
  model: string;
  totalPages: number;
  processedPages: number;
  truncated: boolean;
  embedded: {
    text: string;
    score: number;
    characters: number;
  };
  ocr: {
    text: string;
    score: number;
    characters: number;
    pages: OcrPageComparison[];
  };
  recommendation: "prefer_ocr" | "keep_embedded" | "manual_review";
  warnings: string[];
};

type GeminiPayload = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown; thought?: unknown }> };
  }>;
  error?: { message?: unknown };
};

type PdfScreenshotPage = {
  data: Uint8Array | Buffer;
};

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeSpaces(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanOcrText(value: string) {
  return normalizeSpaces(
    value
      .replace(/```(?:text|markdown)?/giu, "")
      .replace(/^\s*(?:KẾT QUẢ OCR|BẢN CHÉP|TRANSCRIPTION)\s*:?[ \t]*$/gimu, "")
      .replace(/^\s*(?:---\s*)?(?:TRANG|PAGE)\s+\d+(?:\s*\/\s*\d+)?(?:\s*---)?\s*$/gimu, "")
      .replace(/^\s*\[?không có nội dung\]?\s*$/gimu, ""),
  );
}

export function scoreLegalOcrText(value: string) {
  const text = cleanOcrText(value);
  if (!text) return 0;

  const letters = text.match(/\p{L}/gu) ?? [];
  const digits = text.match(/\d/g) ?? [];
  const vietnamese = text.match(/[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/giu) ?? [];
  const legalMarkers = text.match(
    /\b(?:CỘNG HÒA|Độc lập|Số\s*:|Nghị định|Thông tư|Nghị quyết|Quyết định|Luật|Căn cứ|Chương|Mục|Điều|Khoản|Điểm)\b/giu,
  ) ?? [];
  const suspicious = text.match(/[�□■◆◇]|\?{2,}|\b(?:lJ|I0|O0|0O)\b/g) ?? [];
  const brokenTokens = text.match(/\b\p{L}\s+\p{L}\s+\p{L}\b/gu) ?? [];

  const lengthScore = clamp(text.length / 1_400);
  const legalScore = clamp(legalMarkers.length / 5);
  const vietnameseScore = clamp(vietnamese.length / 24);
  const readableRatio = clamp((letters.length + digits.length) / Math.max(1, text.length) / 0.72);
  const lineScore = clamp(text.split("\n").filter((line) => line.trim().length >= 8).length / 12);
  const penalty = clamp((suspicious.length * 4 + brokenTokens.length * 2) / Math.max(20, text.length) * 8);

  return clamp(
    0.08 +
      lengthScore * 0.25 +
      legalScore * 0.26 +
      vietnameseScore * 0.15 +
      readableRatio * 0.16 +
      lineScore * 0.1 -
      penalty * 0.35,
  );
}

function normalizedTokens(value: string) {
  return cleanOcrText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/giu, "d")
    .toLocaleLowerCase("vi")
    .match(/[a-z0-9]+/g) ?? [];
}

export function ocrTokenSimilarity(left: string, right: string) {
  const leftTokens = new Set(normalizedTokens(left));
  const rightTokens = new Set(normalizedTokens(right));
  if (!leftTokens.size && !rightTokens.size) return 1;
  if (!leftTokens.size || !rightTokens.size) return 0;

  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

export function selectBestOcrDraft(drafts: OcrDraft[]) {
  if (!drafts.length) throw new Error("Không có bản OCR để so sánh.");
  return [...drafts].sort((left, right) => {
    const scoreDifference = right.score - left.score;
    if (Math.abs(scoreDifference) > 0.015) return scoreDifference;
    if (left.pass === "consensus" && right.pass !== "consensus") return -1;
    if (right.pass === "consensus" && left.pass !== "consensus") return 1;
    if (left.pass === "embedded" && right.pass !== "embedded") return 1;
    if (right.pass === "embedded" && left.pass !== "embedded") return -1;
    return right.text.length - left.text.length;
  })[0];
}

function normalizeEdgeLine(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/giu, "d")
    .toLocaleLowerCase("vi")
    .replace(/\d+/g, "#")
    .replace(/[^a-z#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isStructuralLegalLine(value: string) {
  return /\b(?:cộng hòa|độc lập|nghị định|thông tư|nghị quyết|quyết định|luật|chương|mục|điều|căn cứ)\b/iu.test(value);
}

export function removeRepeatedPageEdges(pageTexts: string[]) {
  if (pageTexts.length < 2) return pageTexts.map(cleanOcrText);

  const candidates = new Map<string, number>();
  const splitPages = pageTexts.map((page) => cleanOcrText(page).split("\n").map((line) => line.trim()).filter(Boolean));
  for (const lines of splitPages) {
    const edges = [...lines.slice(0, 2), ...lines.slice(-2)];
    const unique = new Set(edges.map(normalizeEdgeLine).filter((line) => line.length >= 3 && line.length <= 90));
    for (const line of unique) candidates.set(line, (candidates.get(line) ?? 0) + 1);
  }

  const threshold = Math.max(2, Math.ceil(pageTexts.length * 0.67));
  const repeated = new Set(
    [...candidates.entries()]
      .filter(([line, count]) => count >= threshold && !isStructuralLegalLine(line))
      .map(([line]) => line),
  );

  return splitPages.map((lines) =>
    lines.filter((line) => !repeated.has(normalizeEdgeLine(line))).join("\n").trim(),
  );
}

function apiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

function ocrModel() {
  return process.env.OCR_GEMINI_MODEL?.trim() || geminiModel();
}

function responseText(payload: GeminiPayload) {
  return cleanOcrText(
    (payload.candidates?.[0]?.content?.parts ?? [])
      .filter((part) => part.thought !== true && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("\n"),
  );
}

async function callGeminiWithImage(image: Buffer, prompt: string, timeoutMs = 45_000) {
  if (!hasGeminiConfig()) throw new Error("Gemini chưa được cấu hình cho OCR.");

  const models = Array.from(new Set([ocrModel(), "gemini-3.1-flash-lite", "gemini-3-flash-preview"]));
  let lastMessage = "";

  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
              parts: [
                {
                  text:
                    "Bạn là bộ OCR cho văn bản pháp luật Việt Nam. Chỉ chép lại ký tự nhìn thấy trong ảnh, không dùng trí nhớ, không diễn giải và không tự bổ sung nội dung.",
                },
              ],
            },
            contents: [
              {
                role: "user",
                parts: [
                  {
                    inline_data: {
                      mime_type: "image/png",
                      data: image.toString("base64"),
                    },
                  },
                  { text: prompt },
                ],
              },
            ],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 8_192,
            },
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as GeminiPayload;
      if (response.ok) {
        const text = responseText(payload);
        if (text) return { text, model };
        lastMessage = "Model không trả về nội dung chữ.";
      } else {
        lastMessage = typeof payload.error?.message === "string" ? payload.error.message : `Gemini trả lỗi ${response.status}.`;
        if (![404, 429, 500, 502, 503, 504].includes(response.status)) break;
      }
    } catch (error) {
      lastMessage = error instanceof Error && error.name === "AbortError" ? "OCR quá thời gian." : "Không kết nối được Gemini OCR.";
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(lastMessage || "Gemini OCR tạm thời không phản hồi.");
}

const LITERAL_PROMPT =
  "OCR nguyên văn trang này. Chỉ trả về phần chữ, không Markdown và không giải thích. Giữ đúng dấu tiếng Việt, chữ hoa/thường, số hiệu, ngày tháng, Điều/Khoản/Điểm, dấu câu và xuống dòng. Không sửa câu theo hiểu biết riêng. Ký tự thật sự không đọc được thì ghi ?.";

const STRUCTURE_PROMPT =
  "Đọc lại độc lập toàn bộ trang văn bản pháp luật này. Chỉ xuất bản chép nguyên văn. Đặc biệt kiểm tra các lỗi OCR thường gặp: 0/O, 1/I/l, 5/S, dấu tiếng Việt, NĐ-CP, TT-BTC, QH, Điều, Khoản, Điểm, số tiền và ngày tháng. Không được suy đoán hoặc viết lại cho trôi chảy.";

function consensusPrompt(literal: string, structure: string) {
  return `Hãy đối chiếu ảnh với hai bản OCR dưới đây và trả về một bản chép nguyên văn duy nhất. Chỉ chọn ký tự được nhìn thấy trong ảnh; không được tự sửa luật, bổ sung câu hoặc diễn giải. Giữ bố cục xuống dòng hợp lý.\n\nBẢN A:\n${literal}\n\nBẢN B:\n${structure}`;
}

async function comparePage(image: Buffer, page: number): Promise<OcrPageComparison> {
  const [literalResponse, structureResponse] = await Promise.all([
    callGeminiWithImage(image, LITERAL_PROMPT),
    callGeminiWithImage(image, STRUCTURE_PROMPT),
  ]);

  const literal: OcrDraft = {
    text: literalResponse.text,
    score: scoreLegalOcrText(literalResponse.text),
    pass: "literal",
  };
  const structure: OcrDraft = {
    text: structureResponse.text,
    score: scoreLegalOcrText(structureResponse.text),
    pass: "structure",
  };
  const similarity = ocrTokenSimilarity(literal.text, structure.text);
  const drafts: OcrDraft[] = [literal, structure];
  let consensusScore: number | null = null;

  if (similarity < 0.94 || Math.max(literal.score, structure.score) < 0.78) {
    try {
      const response = await callGeminiWithImage(image, consensusPrompt(literal.text, structure.text));
      const consensus: OcrDraft = {
        text: response.text,
        score: scoreLegalOcrText(response.text),
        pass: "consensus",
      };
      consensusScore = consensus.score;
      drafts.push(consensus);
    } catch {
      // Giữ hai bản độc lập nếu bước đối chiếu tạm thời thất bại.
    }
  }

  const chosen = selectBestOcrDraft(drafts);
  return {
    page,
    similarity,
    chosenPass: chosen.pass,
    chosenScore: chosen.score,
    literalScore: literal.score,
    structureScore: structure.score,
    consensusScore,
    text: chosen.text,
  };
}

async function safeFetchPdf(urlValue: string, redirects = 0): Promise<{ url: string; buffer: Buffer }> {
  if (!isAllowedLegalSource(urlValue)) throw new Error("URL không thuộc nguồn pháp luật chính thức được phép.");
  if (redirects > 3) throw new Error("Nguồn chuyển hướng quá nhiều lần.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(urlValue, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "ThueLegalReader-OcrLab/1.0" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Nguồn chuyển hướng không hợp lệ.");
      return safeFetchPdf(new URL(location, urlValue).toString(), redirects + 1);
    }
    if (!response.ok) throw new Error(`Nguồn trả lỗi ${response.status}.`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_SOURCE_BYTES) throw new Error("Tệp PDF vượt giới hạn 18 MB.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_SOURCE_BYTES) throw new Error("Tệp PDF vượt giới hạn 18 MB.");
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Liên kết thử nghiệm chưa trỏ trực tiếp tới tệp PDF.");
    return { url: response.url || urlValue, buffer };
  } finally {
    clearTimeout(timer);
  }
}

function recommendation(embeddedScore: number, ocrScore: number) {
  if (ocrScore >= 0.7 && ocrScore >= embeddedScore + 0.08) return "prefer_ocr" as const;
  if (embeddedScore >= 0.74 && embeddedScore >= ocrScore - 0.03) return "keep_embedded" as const;
  return "manual_review" as const;
}

export function ocrLabEnabled() {
  return process.env.ENABLE_OCR_LAB === "true" || process.env.VERCEL_ENV === "preview" || process.env.NODE_ENV === "development";
}

export async function runOcrExperimentFromUrl(urlValue: string, requestedPages = DEFAULT_MAX_PAGES): Promise<OcrExperimentResult> {
  if (!ocrLabEnabled()) throw new Error("OCR Lab chưa được bật cho môi trường này.");
  if (!hasGeminiConfig()) throw new Error("Thiếu GEMINI_API_KEY để chạy OCR thử nghiệm.");

  const maxPages = Math.max(1, Math.min(ABSOLUTE_MAX_PAGES, Math.floor(requestedPages || DEFAULT_MAX_PAGES)));
  const source = await safeFetchPdf(urlValue);
  const [{ PDFParse }, { CanvasFactory }] = await Promise.all([
    import("pdf-parse"),
    import("pdf-parse/worker"),
  ]);
  const parser = new PDFParse({ data: source.buffer, CanvasFactory });

  let embeddedText = "";
  let totalPages = 0;
  let screenshotPages: PdfScreenshotPage[] = [];
  try {
    const [textResult, infoResult] = await Promise.all([
      parser.getText(),
      parser.getInfo(),
    ]);
    embeddedText = normalizeSpaces(textResult.text.replace(/-- \d+ of \d+ --/g, " "));
    totalPages = infoResult.total;
    const screenshots = await parser.getScreenshot({
      desiredWidth: RENDER_WIDTH,
      first: Math.min(totalPages, maxPages),
      imageDataUrl: false,
      imageBuffer: true,
    });
    screenshotPages = screenshots.pages as PdfScreenshotPage[];
  } finally {
    await parser.destroy().catch(() => undefined);
  }

  if (!screenshotPages.length) throw new Error("Không render được trang PDF để OCR.");

  const pageResults: OcrPageComparison[] = [];
  for (let index = 0; index < screenshotPages.length; index += 1) {
    const image = Buffer.from(screenshotPages[index].data);
    pageResults.push(await comparePage(image, index + 1));
  }

  const cleanedPages = removeRepeatedPageEdges(pageResults.map((page) => page.text));
  const ocrText = cleanedPages.join("\n\n").trim();
  const ocrScore = scoreLegalOcrText(ocrText);
  const embeddedScore = scoreLegalOcrText(embeddedText);
  const truncated = totalPages > pageResults.length;
  const warnings: string[] = [
    "Đây là kết quả thử nghiệm, chưa được dùng thay cho toàn văn chính thức trong luồng tra cứu hiện tại.",
  ];
  if (truncated) warnings.push(`Chỉ OCR ${pageResults.length}/${totalPages} trang để đánh giá chất lượng và thời gian xử lý.`);
  if (pageResults.some((page) => page.similarity < 0.8)) warnings.push("Có trang mà hai lượt OCR khác nhau đáng kể; nên kiểm tra thủ công trước khi sử dụng.");

  return {
    sourceUrl: source.url,
    model: ocrModel(),
    totalPages,
    processedPages: pageResults.length,
    truncated,
    embedded: {
      text: embeddedText,
      score: embeddedScore,
      characters: embeddedText.length,
    },
    ocr: {
      text: ocrText,
      score: ocrScore,
      characters: ocrText.length,
      pages: pageResults.map((page, index) => ({ ...page, text: cleanedPages[index] })),
    },
    recommendation: recommendation(embeddedScore, ocrScore),
    warnings,
  };
}
