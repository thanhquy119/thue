import { geminiModel, hasGeminiConfig } from "./gemini";
import { isAllowedLegalSource } from "./ingestion";
import { cleanVisualArtifacts, prepareOcrImageBands } from "./ocr-artifacts";
import {
  cleanOcrText,
  scoreLegalOcrText,
  type OcrExperimentResult,
  type OcrPageComparison,
} from "./ocr-experiment";
import {
  normalizeOcrModelChoice,
  ocrModelCandidates,
  ocrModelResultLabel,
  type OcrModelChoice,
} from "./ocr-models";
import { runOcrBatch, type OcrBatchRequest } from "./ocr-batch-runner";

const MAX_SOURCE_BYTES = 18_000_000;
const RENDER_WIDTH = 1_800;
const MAX_BATCH_PAGES = 3;

type AdaptiveOcrRequest = OcrBatchRequest & { model?: OcrModelChoice };

class RecitationFilteredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecitationFilteredError";
  }
}

type GeminiPayload = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown; thought?: unknown }> };
    finishReason?: unknown;
    finishMessage?: unknown;
  }>;
  promptFeedback?: { blockReason?: unknown };
  error?: { message?: unknown };
};

type PdfScreenshotPage = { data: Uint8Array | Buffer };

function apiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

function configuredOcrModel() {
  return process.env.OCR_GEMINI_MODEL?.trim() || geminiModel();
}

function responseText(payload: GeminiPayload) {
  return cleanOcrText(
    (payload.candidates ?? [])
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .filter((part) => part.thought !== true && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("\n"),
  );
}

function finishReason(payload: GeminiPayload) {
  const value = payload.candidates?.[0]?.finishReason;
  return typeof value === "string" ? value : "";
}

function generationConfig(model: string) {
  return {
    maxOutputTokens: 6_144,
    candidateCount: 1,
    responseMimeType: "text/plain",
    thinkingConfig: /^gemini-3/iu.test(model)
      ? { thinkingLevel: "minimal" }
      : { thinkingBudget: 0 },
  };
}

const BAND_PROMPT = `Nhận dạng ký tự trong mảnh ảnh nhỏ này theo đúng thứ tự từ trên xuống dưới.
Chỉ trả nội dung nhìn thấy; không giải thích, không diễn giải và không tự bổ sung.
Bỏ con dấu, LOGO, watermark, viền trang, đường kẻ trang trí và số trang đứng riêng. Giữ nguyên tiếng Việt, số hiệu, Điều/Khoản/Điểm, dấu câu, danh sách, ô lựa chọn và dòng chấm.

QUY TẮC BẮT BUỘC KHI CÓ BẢNG:
1. Đặt [TABLE] ở dòng trước bảng và [/TABLE] ở dòng sau bảng.
2. Mỗi hàng vật lý là đúng một dòng theo dạng | ô 1 | ô 2 | ... |.
3. Mỗi đường phân cột nhìn thấy phải tương ứng với một dấu |; ô trống vẫn phải giữ vị trí, ví dụ | 3 | Nội dung | □ | □ | | |.
4. Tất cả hàng thuộc cùng một bảng phải có cùng số ô. Không gộp các cột Đạt, Không đạt, Nhận xét hoặc Yêu cầu giải trình vào cột nội dung.
5. Nếu đây là phần tiếp nối của bảng và không thấy hàng tiêu đề, vẫn giữ đủ các cột đang nhìn thấy; không biến bảng thành đoạn văn.
6. Nếu một hàng bị cắt ở mép trên hoặc mép dưới ảnh, ghi phần nhìn thấy vào đúng ô và để trống các ô không nhìn thấy. Không đoán nội dung bị mất.
7. Ô vuông phải giữ là □ hoặc ☑. Không đổi ô vuông thành ký tự khác.

Chữ bị che mà không chắc chắn ghi [không đọc rõ]. Nếu mảnh ảnh không có chữ, trả đúng [không có nội dung chữ].`;

async function callBandModel(image: Buffer, choice: OcrModelChoice) {
  const models = ocrModelCandidates(choice, configuredOcrModel());
  let lastMessage = "";

  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55_000);
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
                  "Bạn thực hiện OCR trên một mảnh ảnh nhỏ. Không dùng trí nhớ, không diễn giải, không bổ sung chữ ngoài ảnh và phải bảo toàn cấu trúc hàng/cột của bảng.",
              }],
            },
            contents: [{
              role: "user",
              parts: [
                {
                  inline_data: {
                    mime_type: "image/png",
                    data: image.toString("base64"),
                  },
                },
                { text: BAND_PROMPT },
              ],
            }],
            generationConfig: generationConfig(model),
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as GeminiPayload;
      if (response.ok) {
        const text = responseText(payload);
        if (text === "[không có nội dung chữ]") return "";
        if (text) return text;
        if (finishReason(payload) === "RECITATION") {
          throw new RecitationFilteredError(
            typeof payload.candidates?.[0]?.finishMessage === "string"
              ? payload.candidates[0].finishMessage
              : "Mảnh ảnh vẫn bị bộ lọc recitation.",
          );
        }
        lastMessage = `Model ${model} trả phản hồi rỗng${finishReason(payload) ? ` (${finishReason(payload)})` : ""}.`;
        continue;
      }
      lastMessage = typeof payload.error?.message === "string"
        ? `${model}: ${payload.error.message}`
        : `${model}: Gemini trả lỗi ${response.status}.`;
      if (![404, 429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) {
      if (error instanceof RecitationFilteredError) throw error;
      lastMessage = error instanceof Error && error.name === "AbortError"
        ? `${model}: OCR mảnh ảnh quá thời gian.`
        : `${model}: Không kết nối được Gemini OCR.`;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(lastMessage || "Không OCR được mảnh ảnh.");
}

function normalizeLine(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/giu, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isTableTag(value: string) {
  return /^\[\/?TABLE\]$/iu.test(value.trim());
}

function balanceTableTags(lines: string[]) {
  const output: string[] = [];
  let open = false;
  for (const line of lines) {
    if (/^\[TABLE\]$/iu.test(line)) {
      if (open) output.push("[/TABLE]");
      output.push("[TABLE]");
      open = true;
      continue;
    }
    if (/^\[\/TABLE\]$/iu.test(line)) {
      if (open) output.push("[/TABLE]");
      open = false;
      continue;
    }
    output.push(line);
  }
  if (open) output.push("[/TABLE]");
  return output;
}

function mergeBandTexts(values: string[]) {
  const output: string[] = [];
  for (const value of values) {
    const cleaned = cleanVisualArtifacts(value).text;
    for (const rawLine of cleaned.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      if (isTableTag(line)) {
        output.push(line.toUpperCase());
        continue;
      }
      const normalized = normalizeLine(line);
      const recent = output
        .slice(-4)
        .filter((existing) => !isTableTag(existing))
        .some((existing) => normalizeLine(existing) === normalized);
      if (!recent) output.push(line);
    }
  }
  return cleanVisualArtifacts(balanceTableTags(output).join("\n")).text;
}

async function ocrFragment(
  image: Buffer,
  choice: OcrModelChoice,
  depth = 0,
): Promise<{ text: string; notices: string[] }> {
  try {
    return { text: await callBandModel(image, choice), notices: [] };
  } catch (error) {
    if (error instanceof RecitationFilteredError && depth < 2) {
      const fragments = await prepareOcrImageBands(image, 2);
      const texts: string[] = [];
      const notices = [`Một vùng bị bộ lọc recitation; đã chia nhỏ thêm ở cấp ${depth + 1}.`];
      for (const fragment of fragments) {
        const recovered = await ocrFragment(fragment, choice, depth + 1);
        if (recovered.text) texts.push(recovered.text);
        notices.push(...recovered.notices);
      }
      return { text: mergeBandTexts(texts), notices };
    }
    return {
      text: "",
      notices: [error instanceof Error ? error.message : "Không OCR được một vùng ảnh."],
    };
  }
}

async function tiledPageOcr(
  image: Buffer,
  page: number,
  choice: OcrModelChoice,
): Promise<OcrPageComparison> {
  const bands = await prepareOcrImageBands(image, 4);
  const texts: string[] = [];
  const notices: string[] = [
    "Trang không có lớp chữ PDF đủ dùng; hệ thống đã chia ảnh thành các vùng nhỏ để tránh bộ lọc recitation.",
    "OCR được yêu cầu giữ nguyên số cột và đánh dấu từng mảnh bảng để có thể ghép lại giữa các vùng/trang.",
  ];

  for (let index = 0; index < bands.length; index += 1) {
    const recovered = await ocrFragment(bands[index], choice);
    if (recovered.text) texts.push(recovered.text);
    notices.push(...recovered.notices.map((notice) => `Vùng ${index + 1}: ${notice}`));
  }

  const text = mergeBandTexts(texts);
  return {
    page,
    similarity: text ? 1 : 0,
    chosenPass: "consensus",
    chosenScore: scoreLegalOcrText(text),
    literalScore: 0,
    structureScore: 0,
    consensusScore: text ? scoreLegalOcrText(text) : 0,
    text,
    notices,
  };
}

function embeddedHasBlockingArtifacts(value: string) {
  return (
    /\bLOGO\b|\bWATERMARK\b|\bSAO\s+Y\s*;/iu.test(value) ||
    /(?:�|■{2,}|◆{2,}|◇{2,}|\?{2,}|\[không đọc rõ\])/iu.test(value)
  );
}

function embeddedIsReliable(value: string) {
  const cleaned = cleanVisualArtifacts(value).text;
  if (cleaned.length < 220) return false;
  if (scoreLegalOcrText(cleaned) < 0.72) return false;
  if (embeddedHasBlockingArtifacts(cleaned)) return false;
  const replacementCount = (cleaned.match(/[�■◆◇]|\?{2,}/g) ?? []).length;
  return replacementCount <= Math.max(1, Math.floor(cleaned.length / 1_500));
}

function embeddedPage(page: number, text: string): OcrPageComparison {
  const cleaned = cleanVisualArtifacts(text).text;
  return {
    page,
    similarity: 1,
    chosenPass: "embedded",
    chosenScore: scoreLegalOcrText(cleaned),
    literalScore: 0,
    structureScore: 0,
    consensusScore: null,
    text: cleaned,
    notices: ["Lớp chữ PDF của trang đạt chất lượng tốt nên không gọi OCR, giúp giảm thời gian và quota."],
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
      headers: { "user-agent": "ThueLegalReader-OcrLab/1.7" },
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
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Liên kết chưa trỏ trực tiếp tới tệp PDF.");
    return { url: response.url || urlValue, buffer };
  } finally {
    clearTimeout(timer);
  }
}

function selectedPages(totalPages: number, request: AdaptiveOcrRequest) {
  const pages = [...new Set((request.pages ?? []).map((page) => Math.floor(page)))]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right)
    .slice(0, MAX_BATCH_PAGES);
  if (!pages.length) throw new Error("Danh sách trang phân tích không hợp lệ.");
  return pages;
}

function recommendation(embeddedScore: number, outputScore: number) {
  if (outputScore >= 0.7 && outputScore >= embeddedScore + 0.08) return "prefer_ocr" as const;
  if (embeddedScore >= 0.74 && embeddedScore >= outputScore - 0.03) return "keep_embedded" as const;
  return "manual_review" as const;
}

async function runExplicitPages(urlValue: string, request: AdaptiveOcrRequest): Promise<OcrExperimentResult> {
  if (!hasGeminiConfig()) throw new Error("Thiếu GEMINI_API_KEY để chạy OCR thử nghiệm.");
  const choice = normalizeOcrModelChoice(request.model);
  const source = await safeFetchPdf(urlValue);
  const [{ PDFParse }, { CanvasFactory }] = await Promise.all([
    import("pdf-parse"),
    import("pdf-parse/worker"),
  ]);
  const parser = new PDFParse({ data: Uint8Array.from(source.buffer), CanvasFactory });

  let totalPages = 0;
  let pages: number[] = [];
  const embeddedPages: string[] = [];
  let screenshots: PdfScreenshotPage[] = [];
  try {
    totalPages = (await parser.getInfo()).total;
    pages = selectedPages(totalPages, request);
    for (const page of pages) {
      try {
        const result = await parser.getText({ partial: [page] });
        embeddedPages.push(
          cleanVisualArtifacts(result.text.replace(/-- \d+ of \d+ --/g, " ")).text,
        );
      } catch {
        embeddedPages.push("");
      }
    }
    screenshots = (await parser.getScreenshot({
      desiredWidth: RENDER_WIDTH,
      partial: pages,
      imageDataUrl: false,
      imageBuffer: true,
    })).pages as PdfScreenshotPage[];
  } finally {
    await parser.destroy().catch(() => undefined);
  }

  const pageResults: OcrPageComparison[] = [];
  for (let index = 0; index < pages.length; index += 1) {
    const embedded = embeddedPages[index] ?? "";
    if (embeddedIsReliable(embedded)) {
      pageResults.push(embeddedPage(pages[index] ?? index + 1, embedded));
    } else {
      const image = screenshots[index]?.data;
      const pageNumber = pages[index] ?? index + 1;
      pageResults.push(
        image
          ? await tiledPageOcr(Buffer.from(image), pageNumber, choice)
          : {
              page: pageNumber,
              similarity: 0,
              chosenPass: "embedded",
              chosenScore: scoreLegalOcrText(embedded),
              literalScore: 0,
              structureScore: 0,
              consensusScore: null,
              text: embedded,
              notices: ["Không render được ảnh trang; tạm dùng lớp chữ PDF."],
            },
      );
    }
  }

  const embeddedText = embeddedPages.filter(Boolean).join("\n\n");
  const outputText = pageResults.map((page) => page.text).filter(Boolean).join("\n\n");
  const embeddedScore = scoreLegalOcrText(embeddedText);
  const outputScore = scoreLegalOcrText(outputText);
  const scannedPages = pageResults.filter((page) => page.chosenPass !== "embedded").map((page) => page.page);
  const retainedPages = pageResults.filter((page) => page.chosenPass === "embedded").map((page) => page.page);
  const warnings = [
    "Đây là kết quả thử nghiệm, chưa được dùng thay cho toàn văn chính thức trong luồng tra cứu hiện tại.",
    `Đợt này đã xử lý trang ${pages.join(", ")} trong tổng số ${totalPages} trang.`,
  ];
  if (retainedPages.length) warnings.push(`Giữ lớp chữ PDF ở trang ${retainedPages.join(", ")} vì chất lượng đã tốt.`);
  if (scannedPages.length) warnings.push(`OCR theo vùng nhỏ ở trang ${scannedPages.join(", ")} để tránh phản hồi RECITATION khi chép nguyên cả trang.`);
  if (choice === "gemini-3.6-flash") warnings.push("Lượt này dùng Gemini 3.6 Flash để đối chiếu trang khó; nên theo dõi hạn mức yêu cầu mỗi ngày.");
  if (!outputText) warnings.push("Không nhận dạng được nội dung chữ đủ tin cậy trong đợt này.");

  return {
    sourceUrl: source.url,
    model: ocrModelResultLabel(choice),
    totalPages,
    processedPages: pageResults.length,
    truncated: totalPages > pageResults.length,
    embedded: {
      text: embeddedText,
      score: embeddedScore,
      characters: embeddedText.length,
    },
    ocr: {
      text: outputText,
      score: outputScore,
      characters: outputText.length,
      pages: pageResults,
    },
    recommendation: recommendation(embeddedScore, outputScore),
    warnings,
  };
}

export async function runAdaptiveOcrBatch(
  urlValue: string,
  request: AdaptiveOcrRequest,
): Promise<OcrExperimentResult> {
  if (request.pages?.length) return runExplicitPages(urlValue, request);
  return runOcrBatch(urlValue, request);
}
