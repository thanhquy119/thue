import { createHash } from "node:crypto";
import { isAllowedLegalSource } from "./ingestion";
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

const OFFICIAL_DOMAINS = ["vbpl.vn", "chinhphu.vn", "mof.gov.vn", "gdt.gov.vn", "moj.gov.vn"];
const GOOGLE_REDIRECT_DOMAINS = [
  "vertexaisearch.cloud.google.com",
  "grounding-api-redirects.googleusercontent.com",
];

type GeminiGroundingMetadata = {
  groundingChunks?: Array<{ web?: { uri?: unknown; title?: unknown } }>;
  groundingSupports?: Array<{
    segment?: { text?: unknown };
    groundingChunkIndices?: unknown;
  }>;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown; thought?: unknown }> };
    groundingMetadata?: GeminiGroundingMetadata;
  }>;
  error?: { message?: unknown };
};

function apiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

export function geminiModel() {
  const configured = process.env.GEMINI_MODEL?.trim();
  if (!configured || configured === "gemini-3.5-flash") return "gemini-2.5-flash";
  return configured;
}

export function hasGeminiConfig() {
  return Boolean(apiKey());
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi");
}

function sourceLabel(value: string) {
  const normalized = normalize(value);
  if (normalized.includes("vbpl.vn")) return "Cơ sở dữ liệu quốc gia về pháp luật";
  if (normalized.includes("chinhphu.vn")) return "Cổng Thông tin điện tử Chính phủ";
  if (normalized.includes("mof.gov.vn")) return "Bộ Tài chính";
  if (normalized.includes("gdt.gov.vn")) return "Cục Thuế";
  if (normalized.includes("moj.gov.vn")) return "Bộ Tư pháp";
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function isOfficialTitle(value: string) {
  const normalized = normalize(value);
  return OFFICIAL_DOMAINS.some((domain) => normalized.includes(domain));
}

function isGoogleRedirect(value: string) {
  try {
    const host = new URL(value).hostname.toLocaleLowerCase("en");
    return GOOGLE_REDIRECT_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function resolveOfficialUrl(value: string) {
  if (isAllowedLegalSource(value)) return value;
  if (!isGoogleRedirect(value)) return null;

  let current = value;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "ThueRo/2.0" },
      });
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) return isAllowedLegalSource(response.url) ? response.url : null;
      const next = new URL(location, current).toString();
      if (isAllowedLegalSource(next)) return next;
      if (!isGoogleRedirect(next)) return null;
      current = next;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  return null;
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

async function callGemini(input: string, system: string, useGoogleSearch: boolean) {
  if (!hasGeminiConfig()) throw new GeminiUnavailableError("Gemini chưa được cấu hình.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), useGoogleSearch ? 15_000 : 25_000);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel())}:generateContent`,
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
          ...(useGoogleSearch ? { tools: [{ google_search: {} }] } : {}),
          generationConfig: {
            temperature: 0.05,
            maxOutputTokens: useGoogleSearch ? 1_600 : 2_400,
          },
        }),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as GeminiResponse;
    if (!response.ok) {
      const message = typeof payload.error?.message === "string" ? payload.error.message : "";
      throw new GeminiUnavailableError(
        response.status === 401 || response.status === 403
          ? "Khóa Gemini không hợp lệ hoặc chưa có quyền dùng Google Search Grounding."
          : `Gemini tạm thời không phản hồi (${response.status})${message ? `: ${message.slice(0, 180)}` : "."}`,
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof GeminiUnavailableError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GeminiUnavailableError("Gemini phản hồi quá chậm.");
    }
    throw new GeminiUnavailableError("Không kết nối được Gemini.");
  } finally {
    clearTimeout(timer);
  }
}

async function groundedSources(metadata: GeminiGroundingMetadata | undefined) {
  const chunks = metadata?.groundingChunks ?? [];
  const snippets = new Map<number, string[]>();
  for (const support of metadata?.groundingSupports ?? []) {
    const text = typeof support.segment?.text === "string" ? support.segment.text.trim() : "";
    const indices = Array.isArray(support.groundingChunkIndices)
      ? support.groundingChunkIndices.filter((index): index is number => Number.isInteger(index))
      : [];
    for (const index of indices) {
      if (text) snippets.set(index, [...(snippets.get(index) ?? []), text]);
    }
  }

  const values = await Promise.all(
    chunks.slice(0, 12).map(async (chunk, index) => {
      const uri = typeof chunk.web?.uri === "string" ? chunk.web.uri : "";
      const title = typeof chunk.web?.title === "string" ? chunk.web.title.trim() : "";
      if (!uri || (!isAllowedLegalSource(uri) && !isOfficialTitle(title))) return null;
      const resolved = await resolveOfficialUrl(uri);
      if (!resolved || !isAllowedLegalSource(resolved)) return null;
      const snippet = Array.from(new Set(snippets.get(index) ?? [])).join(" ").trim();
      return {
        id: `source-${createHash("sha256").update(resolved).digest("hex").slice(0, 20)}`,
        title: title || sourceLabel(resolved),
        url: resolved,
        snippet: snippet || "Nguồn chính thức do Google Search tìm thấy.",
        score: Math.max(0.4, 0.9 - index * 0.04),
        source_label: sourceLabel(resolved),
        previewable: true,
      } satisfies OnlineLegalSource;
    }),
  );

  const available = values.filter((value) => value !== null) as OnlineLegalSource[];
  return available.filter(
    (value, index, all) => all.findIndex((candidate) => candidate.url === value.url) === index,
  );
}

export async function discoverOfficialSources(query: string): Promise<GeminiDiscovery> {
  const today = new Date().toISOString().slice(0, 10);
  const payload = await callGemini(
    query,
    `Bạn là bộ phận tìm nguồn pháp luật thuế Việt Nam. Hôm nay là ${today}. ` +
      "Bắt buộc dùng Google Search. Chỉ tìm văn bản gốc hoặc trang công bố chính thức thuộc chinhphu.vn, vbpl.vn, mof.gov.vn, gdt.gov.vn hoặc moj.gov.vn. " +
      "Nếu người dùng nhập số hiệu, phải ưu tiên kết quả khớp chính xác số hiệu và năm; không tự đổi sang văn bản có cùng số nhưng khác năm. " +
      "Nếu là câu hỏi nghiệp vụ, hãy xác định văn bản chính điều chỉnh trực tiếp nhất. Trả lời ngắn gọn bằng tiếng Việt, nhưng không tự tạo Điều/Khoản khi chưa đọc được toàn văn.",
    true,
  );
  const candidate = payload.candidates?.[0];
  const sources = await groundedSources(candidate?.groundingMetadata);
  if (!sources.length) {
    throw new GeminiUnavailableError("Không tìm thấy nguồn pháp luật chính thức có thể mở và kiểm tra.");
  }
  return { draft_answer: responseText(payload), sources };
}

export async function answerFromOfficialEvidence(
  query: string,
  evidence: Array<{ document_number: string; title: string; excerpts: string[] }>,
) {
  const payload = await callGemini(
    JSON.stringify({ query, evidence }),
    "Bạn là trợ lý tra cứu pháp luật thuế Việt Nam. Chỉ được kết luận từ evidence đã cung cấp, không dùng trí nhớ riêng và không suy đoán. " +
      "Mỗi kết luận quan trọng phải ghi số hiệu văn bản và Điều/Khoản nếu chúng xuất hiện trong evidence. Nếu evidence chưa đủ, nói rõ phần chưa đủ. " +
      "Trả lời tiếng Việt dễ hiểu trong 3-7 đoạn ngắn, không dùng bảng Markdown, không thêm danh sách nguồn ở cuối vì ứng dụng đã hiển thị văn bản gốc.",
    false,
  );
  const text = responseText(payload);
  if (!text) throw new GeminiUnavailableError("Gemini không tạo được câu trả lời từ văn bản chính thức.");
  return text;
}
