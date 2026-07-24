import { createHash } from "node:crypto";
import { isAllowedLegalSource } from "./ingestion.ts";
import type { OnlineLegalSource } from "./types.ts";

type GroundingChunk = {
  web?: {
    uri?: unknown;
    title?: unknown;
  };
};

type GroundingResponse = {
  candidates?: Array<{
    groundingMetadata?: {
      groundingChunks?: GroundingChunk[];
      webSearchQueries?: unknown[];
    };
  }>;
  error?: { message?: unknown };
};

type CachedGroundingResult = {
  expiresAt: number;
  sources: OnlineLegalSource[];
};

type GroundingRequestResult = {
  payload: GroundingResponse;
  model: string;
};

const DEFAULT_GROUNDING_MODEL = "gemini-2.5-flash-lite";
const SUPPORTED_GROUNDING_MODELS = new Set(["gemini-2.5-flash", "gemini-2.5-flash-lite"]);
const RETRYABLE_GROUNDING_STATUSES = new Set([404, 429, 500, 502, 503, 504]);
const GROUNDING_REDIRECT_HOSTS = new Set(["vertexaisearch.cloud.google.com"]);
const FULL_DOCUMENT_NUMBER =
  /\b\d{1,4}\s*\/\s*20\d{2}\s*\/\s*(?:NĐ-CP|ND-CP|TT-[A-ZĐ0-9-]+|NQ-[A-ZĐ0-9-]+|QĐ-[A-ZĐ0-9-]+|QD-[A-Z0-9-]+|QH\d*|UBTVQH\d*)\b/iu;
const CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 100;
const groundingCache = new Map<string, CachedGroundingResult>();

function apiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

function enabledValue(value: string | undefined) {
  return /^(?:1|true|yes|on)$/iu.test(value?.trim() ?? "");
}

function positiveInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1
    ? Math.min(maximum, Math.floor(parsed))
    : fallback;
}

export function searchGroundingEnabled() {
  return enabledValue(process.env.ENABLE_SEARCH_GROUNDING_FALLBACK);
}

export function searchGroundingModel() {
  const configured = (process.env.SEARCH_GROUNDING_GEMINI_MODEL || DEFAULT_GROUNDING_MODEL)
    .trim()
    .replace(/^models\//iu, "");
  return SUPPORTED_GROUNDING_MODELS.has(configured) ? configured : DEFAULT_GROUNDING_MODEL;
}

export function searchGroundingModelCandidates() {
  return Array.from(
    new Set([
      searchGroundingModel(),
      DEFAULT_GROUNDING_MODEL,
      "gemini-2.5-flash",
    ]),
  ).filter((model) => SUPPORTED_GROUNDING_MODELS.has(model));
}

export function searchGroundingMaxResults() {
  return positiveInteger(process.env.SEARCH_GROUNDING_MAX_RESULTS, 6, 10);
}

export function extractGroundingWebChunks(payload: unknown) {
  const response = payload as GroundingResponse;
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  return chunks
    .map((chunk) => ({
      uri: typeof chunk.web?.uri === "string" ? chunk.web.uri.trim() : "",
      title: typeof chunk.web?.title === "string" ? chunk.web.title.trim() : "",
    }))
    .filter((chunk) => chunk.uri);
}

export function isGroundingRedirectUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && GROUNDING_REDIRECT_HOSTS.has(url.hostname.toLocaleLowerCase("en"));
  } catch {
    return false;
  }
}

function cleanDocumentNumber(value: string) {
  return value
    .replace(/\s+/g, "")
    .replace(/ND-CP/iu, "NĐ-CP")
    .replace(/^QD-/iu, "QĐ-");
}

function inferDocumentType(number: string, title: string) {
  const value = `${number} ${title}`.toLocaleLowerCase("vi");
  if (/nđ-cp|nd-cp|nghị định/iu.test(value)) return "Nghị định";
  if (/tt-[a-zđ0-9-]+|thông tư/iu.test(value)) return "Thông tư";
  if (/nq-[a-zđ0-9-]+|nghị quyết/iu.test(value)) return "Nghị quyết";
  if (/qđ-[a-zđ0-9-]+|qd-[a-z0-9-]+|quyết định/iu.test(value)) return "Quyết định";
  if (/qh\d*|luật/iu.test(value)) return "Luật";
  return "Văn bản pháp luật";
}

function inferIssuer(number: string, title: string, url: string) {
  const value = `${number} ${title} ${url}`.toLocaleLowerCase("vi");
  if (/tt-btc|bộ tài chính|mof\.gov\.vn/iu.test(value)) return "Bộ Tài chính";
  if (/nđ-cp|nd-cp|chính phủ|chinhphu\.vn/iu.test(value)) return "Chính phủ";
  if (/qh\d*|quốc hội/iu.test(value)) return "Quốc hội";
  if (/gdt\.gov\.vn|cục thuế/iu.test(value)) return "Cơ quan thuế";
  return undefined;
}

async function resolveOfficialUrl(value: string) {
  if (isAllowedLegalSource(value)) return value;
  if (!isGroundingRedirectUrl(value)) return null;

  let current = value;
  for (let redirects = 0; redirects < 3; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "ThueRo-GroundingResolver/1.0" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return null;
        const next = new URL(location, current).toString();
        if (isAllowedLegalSource(next)) return next;
        if (!isGroundingRedirectUrl(next)) return null;
        current = next;
        continue;
      }
      return isAllowedLegalSource(response.url || current) ? response.url || current : null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function groundingPrompt(query: string) {
  return [
    "Tìm các văn bản pháp luật thuế Việt Nam chính thức và mới nhất có liên quan trực tiếp đến câu hỏi bên dưới.",
    "Chỉ tìm nguồn gốc hoặc trang công bố của cơ quan nhà nước trên các miền chinhphu.vn, vbpl.vn, mof.gov.vn, gdt.gov.vn hoặc moj.gov.vn.",
    "Ưu tiên văn bản đang có hiệu lực, văn bản sửa đổi/bổ sung/thay thế mới hơn và bản toàn văn PDF, DOCX hoặc HTML chính thức.",
    "Không dùng báo chí, blog, diễn đàn, trang tổng hợp luật hoặc nội dung do người dùng đăng.",
    "Không trả lời nghiệp vụ và không suy đoán. Mục đích duy nhất là tìm URL ứng viên để ứng dụng tự tải và xác minh toàn văn.",
    `Câu hỏi: ${query.slice(0, 500)}`,
  ].join("\n");
}

async function requestGroundingModel(model: string, query: string) {
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
          contents: [{ role: "user", parts: [{ text: groundingPrompt(query) }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 768,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as GroundingResponse;
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function requestGrounding(query: string): Promise<GroundingRequestResult> {
  let lastStatus = 0;
  let lastMessage = "";

  for (const model of searchGroundingModelCandidates()) {
    try {
      const { response, payload } = await requestGroundingModel(model, query);
      if (response.ok) return { payload, model };

      lastStatus = response.status;
      lastMessage = typeof payload.error?.message === "string" ? payload.error.message : "";
      if (!RETRYABLE_GROUNDING_STATUSES.has(response.status)) break;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        lastMessage = `Model ${model} phản hồi quá thời gian.`;
        continue;
      }
      lastMessage = error instanceof Error ? error.message : "Không kết nối được Gemini Search Grounding.";
    }
  }

  throw new Error(
    `Search Grounding không dùng được model đã cấu hình${lastStatus ? ` (${lastStatus})` : ""}${
      lastMessage ? `: ${lastMessage.slice(0, 180)}` : "."
    }`,
  );
}

function sourceFromGrounding(url: string, title: string, model: string): OnlineLegalSource {
  const numberMatch = `${title} ${url}`.match(FULL_DOCUMENT_NUMBER)?.[0] ?? "";
  const number = numberMatch ? cleanDocumentNumber(numberMatch) : undefined;
  const safeTitle = title || number || `Nguồn pháp luật từ ${new URL(url).hostname}`;
  return {
    id: `grounding-${createHash("sha256").update(url).digest("hex").slice(0, 20)}`,
    title: safeTitle,
    url,
    snippet:
      "URL được Search Grounding phát hiện nhưng chưa được dùng làm căn cứ. Ứng dụng phải tải, trích xuất và xác minh toàn văn trước khi trả lời.",
    score: 0.8,
    source_label: `Google Search Grounding (${model}) → nguồn chính thức`,
    previewable: true,
    document_number: number,
    document_type: inferDocumentType(number ?? "", safeTitle),
    issuer: inferIssuer(number ?? "", safeTitle, url),
  };
}

function readCache(query: string) {
  const key = query.toLocaleLowerCase("vi").replace(/\s+/g, " ").trim();
  const cached = groundingCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    groundingCache.delete(key);
    return null;
  }
  return cached.sources.map((source) => ({ ...source }));
}

function writeCache(query: string, sources: OnlineLegalSource[]) {
  if (groundingCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = groundingCache.keys().next().value;
    if (typeof oldestKey === "string") groundingCache.delete(oldestKey);
  }
  const key = query.toLocaleLowerCase("vi").replace(/\s+/g, " ").trim();
  groundingCache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    sources: sources.map((source) => ({ ...source })),
  });
}

export async function discoverOfficialSourcesViaGrounding(query: string): Promise<OnlineLegalSource[]> {
  if (!searchGroundingEnabled() || !apiKey()) return [];
  const cleanQuery = query.replace(/\s+/g, " ").trim().slice(0, 500);
  if (cleanQuery.length < 8) return [];

  const cached = readCache(cleanQuery);
  if (cached) return cached;

  const { payload, model } = await requestGrounding(cleanQuery);
  const chunks = extractGroundingWebChunks(payload);
  const sources: OnlineLegalSource[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    if (sources.length >= searchGroundingMaxResults()) break;
    const resolved = await resolveOfficialUrl(chunk.uri).catch(() => null);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    sources.push(sourceFromGrounding(resolved, chunk.title, model));
  }

  writeCache(cleanQuery, sources);
  return sources;
}
