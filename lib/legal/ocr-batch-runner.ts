import { geminiModel, hasGeminiConfig } from "./gemini";
import { isAllowedLegalSource } from "./ingestion";
import {
  cleanVisualArtifacts,
  hasVisualArtifactHints,
  prepareOcrImageVariants,
} from "./ocr-artifacts";
import {
  cleanOcrText,
  ocrTokenSimilarity,
  removeRepeatedPageEdges,
  scoreLegalOcrText,
  selectBestOcrDraft,
  type OcrDraft,
  type OcrExperimentResult,
  type OcrPageComparison,
} from "./ocr-experiment";

const MAX_SOURCE_BYTES = 18_000_000;
const DEFAULT_MAX_PAGES = 3;
const ABSOLUTE_PREVIEW_PAGES = 6;
const MAX_BATCH_PAGES = 3;
const RENDER_WIDTH = 1_800;

export type OcrBatchRequest = {
  maxPages?: number;
  pages?: number[];
};

type GeminiPayload = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown; thought?: unknown }> };
    finishReason?: unknown;
    finishMessage?: unknown;
  }>;
  promptFeedback?: { blockReason?: unknown; blockReasonMessage?: unknown };
  usageMetadata?: {
    promptTokenCount?: unknown;
    candidatesTokenCount?: unknown;
    thoughtsTokenCount?: unknown;
    totalTokenCount?: unknown;
  };
  modelVersion?: unknown;
  error?: { message?: unknown };
};

type PdfScreenshotPage = {
  data: Uint8Array | Buffer;
};

function normalizeSpaces(value: string) {
  return value
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

function payloadDiagnostic(payload: GeminiPayload) {
  const candidate = payload.candidates?.[0];
  const finishReason = typeof candidate?.finishReason === "string" ? candidate.finishReason : "";
  const finishMessage = typeof candidate?.finishMessage === "string" ? candidate.finishMessage : "";
  const blockReason = typeof payload.promptFeedback?.blockReason === "string" ? payload.promptFeedback.blockReason : "";
  const thoughts = Number(payload.usageMetadata?.thoughtsTokenCount ?? 0);
  const output = Number(payload.usageMetadata?.candidatesTokenCount ?? 0);
  const details = [
    finishReason ? `finish=${finishReason}` : "",
    finishMessage,
    blockReason ? `block=${blockReason}` : "",
    thoughts ? `thinking=${thoughts}` : "",
    output ? `output=${output}` : "",
  ].filter(Boolean);
  return details.join(", ");
}

function generationConfig(model: string) {
  const config: Record<string, unknown> = {
    maxOutputTokens: 16_384,
    candidateCount: 1,
    responseMimeType: "text/plain",
  };
  if (/^gemini-3/iu.test(model)) {
    config.thinkingConfig = { thinkingLevel: "minimal" };
  } else {
    config.thinkingConfig = { thinkingBudget: 0 };
  }
  return config;
}

async function callGeminiWithImage(image: Buffer, prompt: string, timeoutMs = 55_000) {
  if (!hasGeminiConfig()) throw new Error("Gemini chưa được cấu hình cho OCR.");

  const models = Array.from(new Set([ocrModel(), "gemini-3.1-flash-lite", "gemini-3-flash-preview"]));
  let lastMessage = "";

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs + attempt * 10_000);
      try {
        const retryInstruction = attempt
          ? "\n\nYêu cầu bắt buộc: phải trả về phần chữ đọc được. Nếu trang không có chữ, trả đúng [không có nội dung chữ]. Không được trả phản hồi rỗng."
          : "";
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
                      "Bạn là bộ OCR cho văn bản pháp luật Việt Nam. Chép trung thực nội dung có ý nghĩa pháp lý nhìn thấy trong ảnh. Bỏ chữ LOGO, watermark, khung viền, đường kẻ trang trí, số trang đứng riêng, metadata máy quét và dòng chứng thực điện tử kiểu SAO Y kèm thời gian. Giữ tiêu đề, Điều/Khoản/Điểm, bảng, biểu mẫu, dòng chấm để điền, danh sách, ô lựa chọn, ghi chú và chú thích có ý nghĩa. Với bảng, mỗi hàng phải nằm trên một dòng và dùng dấu | để phân tách các ô. Không dùng trí nhớ để tự bổ sung. Khi chữ bị che và không thể đọc chắc chắn, ghi [không đọc rõ].",
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
                    { text: `${prompt}${retryInstruction}` },
                  ],
                },
              ],
              generationConfig: generationConfig(model),
            }),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as GeminiPayload;
        if (response.ok) {
          const text = responseText(payload);
          if (text && text !== "[không có nội dung chữ]") return { text, model };
          const diagnostic = payloadDiagnostic(payload);
          lastMessage = `Model trả phản hồi rỗng${diagnostic ? ` (${diagnostic})` : ""}.`;
          continue;
        }

        lastMessage = typeof payload.error?.message === "string"
          ? payload.error.message
          : `Gemini trả lỗi ${response.status}.`;
        if (![404, 429, 500, 502, 503, 504].includes(response.status)) break;
      } catch (error) {
        lastMessage = error instanceof Error && error.name === "AbortError"
          ? "OCR quá thời gian."
          : "Không kết nối được Gemini OCR.";
      } finally {
        clearTimeout(timer);
      }
    }
  }

  throw new Error(lastMessage || "Gemini OCR tạm thời không phản hồi.");
}

const LITERAL_PROMPT =
  "OCR nội dung trang này theo đúng thứ tự đọc. Chỉ trả về phần chữ, không giải thích. Bỏ LOGO, watermark, số trang đứng riêng, khung viền, đường kẻ, metadata scan và dòng SAO Y kèm ngày giờ. Giữ dấu tiếng Việt, chữ hoa/thường, số hiệu, ngày tháng, Điều/Khoản/Điểm, dấu câu, dòng chấm để điền, ô lựa chọn và ghi chú có nghĩa. Nếu có bảng, ghi mỗi hàng trên một dòng theo dạng | ô 1 | ô 2 |. Không sửa câu theo hiểu biết riêng. Phần bị che mà không chắc chắn ghi [không đọc rõ].";

const STRUCTURE_PROMPT =
  "Đọc lại độc lập trang scan văn bản pháp luật này trên ảnh đã tăng tương phản. Chỉ xuất bản chép nội dung có ý nghĩa. Không chép LOGO, watermark, số trang, metadata SAO Y, tên ứng dụng scan, khung và đường trang trí. Kiểm tra 0/O, 1/I/l, 5/S, dấu tiếng Việt, NĐ-CP, TT-BTC, QH, Điều, Khoản, Điểm, số tiền, ngày tháng và chữ bị con dấu/logo chồng lên. Giữ bảng, biểu mẫu, dòng chấm, dấu đầu dòng và ô lựa chọn. Với bảng, mỗi hàng dùng dạng | ô 1 | ô 2 |. Không suy đoán; dùng [không đọc rõ] khi không chắc chắn.";

const TOP_BAND_PROMPT =
  "Đây là phần phía trên của cùng một trang đã phóng lớn. Chép riêng tiêu đề và nội dung có ý nghĩa. Bỏ LOGO, watermark, con dấu chỉ mang tính hình ảnh và khung trang trí. Nếu con dấu hoặc logo chồng chữ, chỉ ghi ký tự xác định chắc chắn; phần còn lại ghi [không đọc rõ]. Không thêm nội dung ngoài ảnh.";

function consensusPrompt(literal: string, structure: string, topBand = "") {
  const recovered = topBand ? `\n\nBẢN ĐỌC VÙNG ĐẦU TRANG ĐÃ PHÓNG LỚN:\n${topBand}` : "";
  return `Đối chiếu ảnh gốc với các bản OCR và trả về một bản chép duy nhất theo đúng thứ tự đọc. Loại LOGO, watermark, số trang đứng riêng, metadata SAO Y/ngày giờ, tên ứng dụng scan, khung và đường trang trí. Giữ toàn bộ nội dung có ý nghĩa pháp lý, bảng, biểu mẫu, dòng chấm, ghi chú, danh sách và ô lựa chọn. Mỗi hàng bảng dùng dạng | ô 1 | ô 2 |. Phần bị che chỉ dùng ký tự xác nhận được từ ảnh; nếu không chắc ghi [không đọc rõ]. Không tự sửa luật, bổ sung câu hoặc diễn giải.\n\nBẢN A:\n${literal || "[lượt A không có kết quả]"}\n\nBẢN B:\n${structure || "[lượt B không có kết quả]"}${recovered}`;
}

function cleanedDraft(text: string, pass: OcrDraft["pass"]): OcrDraft {
  const cleaned = cleanVisualArtifacts(text).text;
  return {
    text: cleaned,
    score: scoreLegalOcrText(cleaned),
    pass,
  };
}

function settledMessage(result: PromiseSettledResult<{ text: string; model: string }>, label: string) {
  if (result.status === "fulfilled") return "";
  return `${label}: ${result.reason instanceof Error ? result.reason.message : "không có kết quả"}`;
}

async function comparePage(image: Buffer, page: number, embeddedFallback = ""): Promise<OcrPageComparison> {
  const variants = await prepareOcrImageVariants(image);
  const [literalResult, structureResult] = await Promise.allSettled([
    callGeminiWithImage(variants.original, LITERAL_PROMPT),
    callGeminiWithImage(variants.enhanced, STRUCTURE_PROMPT),
  ]);

  const notices = [
    settledMessage(literalResult, "Lượt A"),
    settledMessage(structureResult, "Lượt B"),
  ].filter(Boolean);
  const literal = literalResult.status === "fulfilled"
    ? cleanedDraft(literalResult.value.text, "literal")
    : null;
  const structure = structureResult.status === "fulfilled"
    ? cleanedDraft(structureResult.value.text, "structure")
    : null;
  const drafts: OcrDraft[] = [literal, structure].filter((draft): draft is OcrDraft => Boolean(draft?.text));
  const similarity = literal && structure ? ocrTokenSimilarity(literal.text, structure.text) : 0;
  let consensusScore: number | null = null;

  const rawLiteral = literalResult.status === "fulfilled" ? literalResult.value.text : "";
  const rawStructure = structureResult.status === "fulfilled" ? structureResult.value.text : "";
  const needsRecovery =
    drafts.length < 2 ||
    similarity < 0.94 ||
    Math.max(literal?.score ?? 0, structure?.score ?? 0) < 0.78 ||
    hasVisualArtifactHints(rawLiteral) ||
    hasVisualArtifactHints(rawStructure);

  if (needsRecovery && drafts.length) {
    let topBandText = "";
    try {
      const topBandResponse = await callGeminiWithImage(variants.topBand, TOP_BAND_PROMPT);
      topBandText = cleanVisualArtifacts(topBandResponse.text).text;
    } catch (error) {
      notices.push(`Vùng đầu trang: ${error instanceof Error ? error.message : "không có kết quả"}`);
    }

    try {
      const response = await callGeminiWithImage(
        variants.original,
        consensusPrompt(literal?.text ?? "", structure?.text ?? "", topBandText),
      );
      const consensus = cleanedDraft(response.text, "consensus");
      consensusScore = consensus.score;
      if (consensus.text) drafts.push(consensus);
    } catch (error) {
      notices.push(`Đối chiếu: ${error instanceof Error ? error.message : "không có kết quả"}`);
    }
  }

  if (!drafts.length) {
    const fallback = cleanVisualArtifacts(embeddedFallback).text;
    const embedded: OcrDraft = {
      text: fallback,
      score: scoreLegalOcrText(fallback),
      pass: "embedded",
    };
    notices.push(
      fallback
        ? "Hai lượt OCR không trả chữ; trang này tạm dùng lớp chữ PDF để không làm hỏng toàn bộ tiến trình."
        : "Trang này không có kết quả OCR và cũng không có lớp chữ PDF đủ dùng.",
    );
    return {
      page,
      similarity,
      chosenPass: embedded.pass,
      chosenScore: embedded.score,
      literalScore: 0,
      structureScore: 0,
      consensusScore,
      text: embedded.text,
      notices,
    };
  }

  const chosen = selectBestOcrDraft(drafts);
  return {
    page,
    similarity,
    chosenPass: chosen.pass,
    chosenScore: chosen.score,
    literalScore: literal?.score ?? 0,
    structureScore: structure?.score ?? 0,
    consensusScore,
    text: chosen.text,
    notices: notices.length ? notices : undefined,
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
      headers: { "user-agent": "ThueLegalReader-OcrLab/1.4" },
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

function requestedPageNumbers(totalPages: number, request: OcrBatchRequest) {
  if (Array.isArray(request.pages) && request.pages.length) {
    const unique = [...new Set(request.pages.map((page) => Math.floor(page)))]
      .filter((page) => page >= 1 && page <= totalPages)
      .sort((left, right) => left - right)
      .slice(0, MAX_BATCH_PAGES);
    if (!unique.length) throw new Error("Danh sách trang OCR không hợp lệ.");
    return unique;
  }

  const maxPages = Math.max(
    1,
    Math.min(ABSOLUTE_PREVIEW_PAGES, Math.floor(request.maxPages || DEFAULT_MAX_PAGES)),
  );
  return Array.from({ length: Math.min(totalPages, maxPages) }, (_, index) => index + 1);
}

export async function runOcrBatch(
  urlValue: string,
  request: OcrBatchRequest = { maxPages: DEFAULT_MAX_PAGES },
): Promise<OcrExperimentResult> {
  if (!hasGeminiConfig()) throw new Error("Thiếu GEMINI_API_KEY để chạy OCR thử nghiệm.");

  const source = await safeFetchPdf(urlValue);
  const [{ PDFParse }, { CanvasFactory }] = await Promise.all([
    import("pdf-parse"),
    import("pdf-parse/worker"),
  ]);

  const transferablePdf = Uint8Array.from(source.buffer);
  const parser = new PDFParse({ data: transferablePdf, CanvasFactory });

  let embeddedText = "";
  let embeddedPages: string[] = [];
  let totalPages = 0;
  let selectedPages: number[] = [];
  let screenshotPages: PdfScreenshotPage[] = [];
  try {
    const infoResult = await parser.getInfo();
    totalPages = infoResult.total;
    selectedPages = requestedPageNumbers(totalPages, request);

    embeddedPages = [];
    for (const page of selectedPages) {
      try {
        const pageText = await parser.getText({ partial: [page] });
        embeddedPages.push(
          cleanVisualArtifacts(
            normalizeSpaces(pageText.text.replace(/-- \d+ of \d+ --/g, " ")),
          ).text,
        );
      } catch {
        embeddedPages.push("");
      }
    }
    embeddedText = embeddedPages.filter(Boolean).join("\n\n");

    const screenshots = await parser.getScreenshot({
      desiredWidth: RENDER_WIDTH,
      partial: selectedPages,
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
    pageResults.push(await comparePage(image, selectedPages[index], embeddedPages[index] ?? ""));
  }

  const repeatedEdgesRemoved = removeRepeatedPageEdges(pageResults.map((page) => page.text));
  const cleanedPages = repeatedEdgesRemoved.map((page) => cleanVisualArtifacts(page).text);
  const ocrText = cleanedPages.filter(Boolean).join("\n\n").trim();
  const ocrScore = scoreLegalOcrText(ocrText);
  const embeddedScore = scoreLegalOcrText(embeddedText);
  const truncated = totalPages > pageResults.length;
  const warnings: string[] = [
    "Đây là kết quả thử nghiệm, chưa được dùng thay cho toàn văn chính thức trong luồng tra cứu hiện tại.",
    "Hệ thống đã tự bỏ logo/watermark, số trang đứng riêng, metadata SAO Y, tên ứng dụng scan, khung và đường trang trí; ghi chú có ý nghĩa pháp lý vẫn được giữ lại.",
  ];
  if (truncated) warnings.push(`Đợt này đã xử lý trang ${selectedPages.join(", ")} trong tổng số ${totalPages} trang.`);
  if (pageResults.some((page) => page.similarity < 0.8 && page.chosenPass !== "embedded")) warnings.push("Có trang mà hai lượt OCR khác nhau đáng kể; nên kiểm tra thủ công trước khi sử dụng.");
  const fallbackPages = pageResults.filter((page) => page.chosenPass === "embedded").map((page) => page.page);
  if (fallbackPages.length) warnings.push(`Gemini không trả chữ ở trang ${fallbackPages.join(", ")}; hệ thống đã giữ lớp chữ PDF của các trang đó thay vì làm dừng toàn bộ tệp.`);
  if (/\[không đọc rõ\]/iu.test(ocrText)) warnings.push("Có vùng chữ bị logo, con dấu hoặc nhiễu che mà hệ thống không thể xác nhận chắc chắn; vị trí đó được đánh dấu [không đọc rõ].");

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
