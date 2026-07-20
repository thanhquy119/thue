import { discoverOfficialSources as discoverViaRss } from "./discovery";
import type { OnlineLegalSource } from "./types";

export class GeminiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiUnavailableError";
  }
}

export type GeminiDiscovery = {
  draft_answer: string;
  sources: OnlineLegalSource[];
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown; thought?: unknown }> };
  }>;
  error?: { message?: unknown };
};

export type OfficialEvidence = {
  document_number: string;
  title: string;
  issued_date: string | null;
  effective_date: string | null;
  status: string;
  excerpts: string[];
};

function apiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

export function geminiModel() {
  const configured = process.env.GEMINI_MODEL?.trim();
  const unavailableForThisFreeProject = new Set([
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3.5-flash",
  ]);
  if (!configured || unavailableForThisFreeProject.has(configured)) return "gemini-3.1-flash-lite";
  return configured;
}

export function hasGeminiConfig() {
  return Boolean(apiKey());
}

function responseText(payload: GeminiResponse) {
  return (payload.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => part.thought !== true && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
    .replace(/```(?:text|markdown|json)?/gi, "")
    .replace(/\*\*/g, "")
    .trim();
}

async function callModel(model: string, input: string, system: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
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
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: input }] }],
          generationConfig: {
            temperature: 0.02,
            maxOutputTokens: 2_400,
          },
        }),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as GeminiResponse;
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(input: string, system: string) {
  if (!hasGeminiConfig()) throw new GeminiUnavailableError("Gemini chưa được cấu hình.");

  const models = Array.from(new Set([geminiModel(), "gemini-3.1-flash-lite", "gemini-3-flash-preview"]));
  let lastStatus = 0;
  let lastMessage = "";

  for (const model of models) {
    try {
      const { response, payload } = await callModel(model, input, system);
      if (response.ok) return payload;
      lastStatus = response.status;
      lastMessage = typeof payload.error?.message === "string" ? payload.error.message : "";
      if (![404, 429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        lastMessage = "Gemini phản hồi quá chậm.";
        continue;
      }
      lastMessage = "Không kết nối được Gemini.";
    }
  }

  throw new GeminiUnavailableError(
    lastStatus === 401 || lastStatus === 403
      ? "Khóa Gemini không hợp lệ hoặc chưa có quyền sử dụng model."
      : `Gemini tạm thời không phản hồi${lastStatus ? ` (${lastStatus})` : ""}${lastMessage ? `: ${lastMessage.slice(0, 180)}` : "."}`,
  );
}

export async function discoverOfficialSources(query: string): Promise<GeminiDiscovery> {
  return discoverViaRss(query);
}

export async function answerFromOfficialEvidence(query: string, evidence: OfficialEvidence[]) {
  const payload = await callGemini(
    JSON.stringify({ current_date: new Date().toISOString().slice(0, 10), query, evidence }),
    "Bạn là trợ lý tra cứu pháp luật thuế Việt Nam. Chỉ được kết luận từ evidence đã cung cấp, không dùng trí nhớ riêng và không suy đoán. " +
      "Trước khi trả lời, phải so sánh ngày ban hành, ngày hiệu lực và quan hệ sửa đổi/bổ sung thể hiện trong tiêu đề hoặc nội dung. " +
      "Khi văn bản mới sửa đổi, bổ sung hoặc thay thế quy định cũ, phải áp dụng nội dung mới; tuyệt đối không lặp lại ngưỡng, mức thuế hoặc thủ tục cũ. " +
      "Nếu các evidence mâu thuẫn mà chưa đủ căn cứ xác định văn bản hiện hành, phải nói rõ chưa thể kết luận thay vì chọn tùy ý. " +
      "Mỗi kết luận quan trọng phải ghi số hiệu văn bản và Điều/Khoản nếu chúng xuất hiện trong evidence. " +
      "Trả lời tiếng Việt dễ hiểu trong 3-7 đoạn ngắn, không dùng bảng Markdown, không thêm danh sách nguồn ở cuối vì ứng dụng đã hiển thị văn bản gốc.",
  );
  const text = responseText(payload);
  if (!text) throw new GeminiUnavailableError("Gemini không tạo được câu trả lời từ văn bản chính thức.");
  return text;
}
