import { discoverOfficialSources as discoverViaRss } from "./discovery";
import {
  analyzeTaxQuestion,
  answerGroundingIssues,
  buildTaxSearchQueries,
  taxSourceRelevance,
} from "./question-intelligence";
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

function normalizeVietnamese(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMoney(value: string) {
  const normalized = normalizeVietnamese(value).replace(/(?<=\d)\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(trieu|ty)\s*(?:dong)?/);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  return number * (match[2] === "ty" ? 1_000_000_000 : 1_000_000);
}

function formatIsoDate(value: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return null;
  return `${day}/${month}/${year}`;
}

function deterministicHouseholdRevenueAnswer(query: string, evidence: OfficialEvidence[]) {
  const normalizedQuery = normalizeVietnamese(query);
  const isHouseholdTaxQuestion =
    /\b(?:ho kinh doanh|ca nhan kinh doanh)\b/.test(normalizedQuery) &&
    /\bdoanh thu\b/.test(normalizedQuery) &&
    /\b(?:thue|nop thue|khong phai nop)\b/.test(normalizedQuery);
  if (!isHouseholdTaxQuestion) return null;

  for (const document of evidence) {
    const combined = [document.title, ...document.excerpts].join("\n");
    const normalizedCombined = normalizeVietnamese(combined);
    if (!/\b(?:ho kinh doanh|ca nhan kinh doanh)\b/.test(normalizedCombined)) continue;

    const amendment = combined.match(
      /sửa\s+đổi\s+cụm\s+từ\s*[“"']?\s*([0-9][0-9.,]*\s*(?:triệu|tỷ)\s*đồng)\s*[”"']?\s+thành\s*[“"']?\s*([0-9][0-9.,]*\s*(?:triệu|tỷ)\s*đồng)/iu,
    );
    if (!amendment) continue;

    const oldThreshold = parseMoney(amendment[1]);
    const newThreshold = parseMoney(amendment[2]);
    if (!oldThreshold || !newThreshold || newThreshold <= oldThreshold) continue;

    const mentionsTaxArticles = /Điều\s+3\s*,?\s*Điều\s+4/iu.test(combined);
    if (!mentionsTaxArticles && !/(?:không\s+chịu\s+thuế|không\s+phải\s+nộp\s+thuế)/iu.test(combined)) continue;

    const queryAmountMatch = query.match(/[0-9][0-9.,]*\s*(?:triệu|tỷ)\s*(?:đồng)?/iu);
    const queryAmount = queryAmountMatch ? parseMoney(queryAmountMatch[0]) : null;
    const effectiveDate = formatIsoDate(document.effective_date);
    const effectivePhrase = effectiveDate ? `, có hiệu lực từ ngày ${effectiveDate}` : "";
    const thresholdLabel = amendment[2].replace(/^0+(?=\d)/, "");

    const basis = `${document.document_number}${effectivePhrase} sửa mức doanh thu trong Nghị định số 68/2026/NĐ-CP từ ${amendment[1]} thành ${thresholdLabel}, bao gồm Điều 3 và Điều 4 về thuế GTGT và thuế TNCN.`;

    if (queryAmount !== null) {
      if (queryAmount <= newThreshold) {
        return `${basis}\n\nVì doanh thu nêu trong câu hỏi là ${queryAmountMatch?.[0].trim()}, không vượt quá ${thresholdLabel}/năm, hộ kinh doanh thuộc diện không chịu thuế GTGT và không phải nộp thuế TNCN đối với hoạt động kinh doanh.\n\nKết luận này chỉ áp dụng cho thuế GTGT và thuế TNCN theo ngưỡng doanh thu; các nghĩa vụ về đăng ký, khai báo doanh thu, hóa đơn hoặc loại thuế khác vẫn cần đối chiếu theo tình huống thực tế.`;
      }
      return `${basis}\n\nVì doanh thu nêu trong câu hỏi là ${queryAmountMatch?.[0].trim()}, vượt ${thresholdLabel}/năm, hộ kinh doanh thuộc diện phải xác định nghĩa vụ thuế GTGT và thuế TNCN theo phương pháp áp dụng cho hoạt động kinh doanh của mình. Mức thuế cụ thể còn phụ thuộc ngành nghề và doanh thu tính thuế.`;
    }

    return `${basis}\n\nTheo đó, hộ kinh doanh, cá nhân kinh doanh có doanh thu năm từ ${thresholdLabel} trở xuống không chịu thuế GTGT và không phải nộp thuế TNCN; doanh thu trên ngưỡng này phải xác định nghĩa vụ thuế theo quy định hiện hành.`;
  }

  return null;
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

function mergeOfficialSources(groups: OnlineLegalSource[][], query: string) {
  const byUrl = new Map<string, OnlineLegalSource>();
  for (const source of groups.flat()) {
    const relevance = taxSourceRelevance(
      query,
      `${source.document_number ?? ""} ${source.document_type ?? ""} ${source.title} ${source.snippet} ${source.issuer ?? ""}`,
    );
    const candidate = { ...source, score: source.score + Math.max(0, relevance) };
    const existing = byUrl.get(source.url);
    if (!existing || candidate.score > existing.score) byUrl.set(source.url, candidate);
  }
  return [...byUrl.values()];
}

export async function discoverOfficialSources(query: string): Promise<GeminiDiscovery> {
  const plan = analyzeTaxQuestion(query);
  if (!plan.isQuestion || plan.hasDocumentReference) return discoverViaRss(query);

  const searches = buildTaxSearchQueries(query, plan);
  const settled = await Promise.allSettled(searches.map((search) => discoverViaRss(search)));
  const fulfilled = settled
    .filter((result): result is PromiseFulfilledResult<GeminiDiscovery> => result.status === "fulfilled")
    .map((result) => result.value);

  if (!fulfilled.length) {
    const firstError = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    throw firstError?.reason instanceof Error
      ? firstError.reason
      : new Error("Không kết nối được nguồn pháp luật chính thức.");
  }

  const minimumRelevance = plan.taxAreas.length ? 1.4 : 0.6;
  const sources = mergeOfficialSources(
    fulfilled.map((result) => result.sources),
    query,
  )
    .filter((source) =>
      taxSourceRelevance(
        query,
        `${source.document_number ?? ""} ${source.document_type ?? ""} ${source.title} ${source.snippet} ${source.issuer ?? ""}`,
      ) >= minimumRelevance,
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, 30);

  return {
    draft_answer: sources.length
      ? "Đã tìm thấy nguồn chính thức phù hợp với lĩnh vực và nghiệp vụ trong câu hỏi."
      : "Chưa tìm thấy nguồn chính thức đủ liên quan để kết luận an toàn.",
    sources,
  };
}

export async function answerFromOfficialEvidence(query: string, evidence: OfficialEvidence[]) {
  const deterministic = deterministicHouseholdRevenueAnswer(query, evidence);
  if (deterministic) return deterministic;

  const payload = await callGemini(
    JSON.stringify({ current_date: new Date().toISOString().slice(0, 10), query, evidence }),
    "Bạn là trợ lý tra cứu pháp luật thuế Việt Nam. Chỉ được kết luận từ evidence đã cung cấp, không dùng trí nhớ riêng và không suy đoán. " +
      "Trước khi trả lời, phải so sánh ngày ban hành, ngày hiệu lực và quan hệ sửa đổi/bổ sung thể hiện trong tiêu đề hoặc nội dung. " +
      "Khi văn bản mới sửa đổi, bổ sung hoặc thay thế quy định cũ, phải áp dụng nội dung mới; tuyệt đối không lặp lại ngưỡng, mức thuế hoặc thủ tục cũ. " +
      "Không được đưa ra số tiền, tỷ lệ phần trăm, thời hạn hoặc ngưỡng nếu dữ kiện đó không xuất hiện rõ trong evidence. " +
      "Nếu câu hỏi thiếu dữ kiện để áp dụng cho một trường hợp cụ thể, phải nêu rõ dữ kiện còn thiếu thay vì tự giả định. " +
      "Nếu các evidence mâu thuẫn mà chưa đủ căn cứ xác định văn bản hiện hành, phải nói rõ chưa thể kết luận thay vì chọn tùy ý. " +
      "Mỗi kết luận quan trọng phải ghi số hiệu văn bản và Điều/Khoản nếu chúng xuất hiện trong evidence. " +
      "Trả lời tiếng Việt dễ hiểu trong 3-7 đoạn ngắn, không dùng bảng Markdown, không thêm danh sách nguồn ở cuối vì ứng dụng đã hiển thị văn bản gốc.",
  );
  const text = responseText(payload);
  if (!text) throw new GeminiUnavailableError("Gemini không tạo được câu trả lời từ văn bản chính thức.");

  const evidenceText = evidence
    .flatMap((document) => [document.document_number, document.title, ...document.excerpts])
    .join("\n");
  const issues = answerGroundingIssues(
    text,
    evidenceText,
    evidence.map((document) => document.document_number),
  );
  if (issues.includes("unsupported_numeric_claim")) {
    throw new GeminiUnavailableError("Câu trả lời có con số chưa được xác minh trong căn cứ chính thức.");
  }
  if (issues.includes("missing_document_reference")) {
    throw new GeminiUnavailableError("Câu trả lời chưa gắn kết luận với số hiệu văn bản trong căn cứ.");
  }
  return text;
}
