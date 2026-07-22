import { hasGeminiConfig } from "./gemini";
import { cleanVisualArtifacts } from "./ocr-artifacts";
import { ocrModelCandidates } from "./ocr-models";
import {
  cleanOcrTextForQuality,
  scoreLegalOcrTextForQuality,
} from "./ocr-quality";

const OCR_TIMEOUT_MS = 45_000;
const MAX_INLINE_PDF_BYTES = 18_000_000;

export type ProductionOcrAssessment = {
  accepted: boolean;
  text: string;
  score: number;
  warnings: string[];
};

export type ProductionOcrResult = ProductionOcrAssessment & {
  model: string;
  totalPages: number;
};

type GeminiPayload = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown; thought?: unknown }> };
    finishReason?: unknown;
    finishMessage?: unknown;
  }>;
  error?: { message?: unknown };
};

function productionOcrEnabled() {
  return process.env.ENABLE_OCR_FALLBACK !== "false";
}

function apiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

function payloadText(payload: GeminiPayload) {
  return (payload.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .filter((part) => part.thought !== true && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
    .replace(/```(?:text|markdown)?/giu, "")
    .trim();
}

function countPageMarkers(value: string) {
  const pages = [...value.matchAll(/^\s*(?:---\s*)?(?:TRANG|PAGE)\s+(\d+)(?:\s*\/\s*\d+)?(?:\s*---)?\s*$/gimu)]
    .map((match) => Number(match[1]))
    .filter((page) => Number.isFinite(page) && page >= 1);
  return new Set(pages).size;
}

export function evaluateProductionOcrText(
  rawText: string,
  totalPages: number,
  finishReason = "STOP",
): ProductionOcrAssessment {
  const artifactCleaned = cleanVisualArtifacts(rawText).text;
  const text = cleanOcrTextForQuality(artifactCleaned);
  const score = scoreLegalOcrTextForQuality(text);
  const warnings: string[] = [];
  const pageMarkers = countPageMarkers(rawText);
  const unreadable = text.match(/\[không đọc rõ\]/giu)?.length ?? 0;
  const legalMarkers = text.match(/\b(?:Điều|Chương|Mục|Khoản)\s+[0-9IVXLC]+/giu)?.length ?? 0;
  const minimumCharacters = Math.max(800, Math.min(Math.max(1, totalPages), 80) * 260);

  if (/MAX_TOKENS|RECITATION|SAFETY|BLOCK/iu.test(finishReason)) {
    warnings.push(`OCR kết thúc không trọn vẹn (${finishReason}); không dùng làm nguyên văn chính thức.`);
  }
  if (text.length < minimumCharacters) {
    warnings.push(`OCR chỉ trả ${text.length.toLocaleString("vi-VN")} ký tự, thấp hơn ngưỡng ${minimumCharacters.toLocaleString("vi-VN")} ký tự cho ${totalPages} trang.`);
  }
  if (score < 0.68) warnings.push(`Điểm chất lượng OCR ${Math.round(score * 100)}% chưa đạt ngưỡng 68%.`);
  if (totalPages >= 4 && pageMarkers > 0 && pageMarkers < Math.ceil(totalPages * 0.7)) {
    warnings.push(`OCR chỉ đánh dấu ${pageMarkers}/${totalPages} trang; kết quả có nguy cơ bị cắt giữa tệp.`);
  }
  if (unreadable > Math.max(3, Math.ceil(totalPages * 0.35))) {
    warnings.push(`Còn ${unreadable} vùng [không đọc rõ], vượt ngưỡng an toàn.`);
  }
  if (totalPages >= 2 && legalMarkers < 2) {
    warnings.push("Kết quả thiếu các mốc Điều/Chương/Mục/Khoản cần thiết để xác nhận đây là toàn văn pháp luật.");
  }

  return {
    accepted: warnings.length === 0,
    text,
    score,
    warnings,
  };
}

const OCR_PROMPT = `Bạn đang thực hiện OCR dự phòng cuối cùng cho một PDF pháp luật Việt Nam mà hệ thống không lấy được DOCX, DOC, HTML text hoặc lớp chữ PDF đủ dùng.

Hãy chép TOÀN BỘ nội dung có ý nghĩa pháp lý của tệp từ trang đầu đến trang cuối theo đúng thứ tự đọc.

Yêu cầu bắt buộc:
- Chỉ chép nội dung nhìn thấy trong PDF; không diễn giải, tóm tắt, sửa luật hoặc bổ sung từ trí nhớ.
- Trước nội dung mỗi trang ghi một dòng: --- TRANG n ---.
- Giữ nguyên quốc hiệu, cơ quan ban hành, số hiệu, ngày tháng, tên văn bản, Căn cứ, Điều, Khoản, Điểm, Chương, Mục, phụ lục, ghi chú, nơi nhận và chữ ký dạng chữ.
- Giữ bảng theo từng hàng bằng dấu |, giữ đủ ô trống và các ký hiệu □ hoặc ☑.
- Giữ dòng chấm của biểu mẫu khi nó mang ý nghĩa trường cần điền.
- Bỏ LOGO, watermark, dấu mộc chỉ mang tính hình ảnh, khung viền, số trang đứng riêng, metadata máy quét và dòng SAO Y kèm thời gian kỹ thuật.
- Phần bị che hoặc không thể xác nhận chắc chắn phải ghi [không đọc rõ], tuyệt đối không đoán.
- Không dùng Markdown ngoài các dòng phân cách trang và dấu | của bảng.
- Phải tiếp tục đến hết trang cuối; không dừng sau vài trang.`;

async function callPdfOcr(buffer: Buffer, model: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
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
              text: "Bạn là bộ OCR pháp luật Việt Nam. Nhiệm vụ duy nhất là chép trung thực toàn bộ PDF, không suy đoán và không tạo nội dung mới.",
            }],
          },
          contents: [{
            role: "user",
            parts: [
              {
                inline_data: {
                  mime_type: "application/pdf",
                  data: buffer.toString("base64"),
                },
              },
              { text: OCR_PROMPT },
            ],
          }],
          generationConfig: {
            temperature: 0,
            candidateCount: 1,
            responseMimeType: "text/plain",
            maxOutputTokens: 65_536,
            thinkingConfig: /^gemini-3/iu.test(model)
              ? { thinkingLevel: "minimal" }
              : { thinkingBudget: 0 },
          },
        }),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as GeminiPayload;
    if (!response.ok) {
      const message = typeof payload.error?.message === "string" ? payload.error.message : `Gemini OCR trả lỗi ${response.status}.`;
      throw new Error(message);
    }
    const candidate = payload.candidates?.[0];
    const text = payloadText(payload);
    if (!text) throw new Error("Gemini OCR không trả về nội dung chữ.");
    return {
      text,
      finishReason: typeof candidate?.finishReason === "string" ? candidate.finishReason : "STOP",
      finishMessage: typeof candidate?.finishMessage === "string" ? candidate.finishMessage : "",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runProductionPdfOcr(
  buffer: Buffer,
  totalPages: number,
): Promise<ProductionOcrResult | null> {
  if (!productionOcrEnabled() || !hasGeminiConfig()) return null;
  if (!buffer.length || buffer.length > MAX_INLINE_PDF_BYTES) return null;
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") return null;

  const configured = process.env.OCR_GEMINI_MODEL?.trim();
  const candidates = ocrModelCandidates("auto", configured);
  let lastError = "";

  for (const model of candidates) {
    try {
      const response = await callPdfOcr(buffer, model);
      const assessment = evaluateProductionOcrText(response.text, totalPages, response.finishReason);
      if (!assessment.accepted) {
        lastError = [...assessment.warnings, response.finishMessage].filter(Boolean).join(" ");
        continue;
      }
      return {
        ...assessment,
        model,
        totalPages,
      };
    } catch (error) {
      lastError = error instanceof Error && error.name === "AbortError"
        ? "OCR PDF vượt quá thời gian xử lý."
        : error instanceof Error ? error.message : "OCR PDF thất bại.";
    }
  }

  if (lastError) console.warn(`[ocr-fallback] ${lastError}`);
  return null;
}
