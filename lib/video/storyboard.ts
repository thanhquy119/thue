import type {DocumentDetail} from "@/lib/legal/types";
import {
  detectVideoCoverage,
  extractVideoNumberTokens,
  normalizeVideoEvidence,
  sourceContainsEvidence,
  videoLengthProfile,
  VIDEO_TEMPLATE_VERSION,
} from "./chunking";
import {repairVideoEvidenceCoverage} from "./coverage-repair";
import type {
  LegalVideoCategory,
  LegalVideoEvidencePoint,
  LegalVideoEvidenceSection,
  LegalVideoLength,
  LegalVideoScene,
  LegalVideoSceneKind,
  LegalVideoStoryboard,
  LegalVideoVisualMode,
  LegalVideoVoice,
} from "./types";

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const FALLBACK_MODELS = ["gemini-3.1-flash-lite", "gemini-3-flash-preview"] as const;
const CATEGORIES: LegalVideoCategory[] = [
  "overview", "scope", "changes", "procedure", "obligation", "deadline",
  "numbers", "effective", "transition", "forms", "prepare",
];

function geminiKey() {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || "";
}

export function videoGeminiConfigured() {
  return Boolean(geminiKey());
}

function modelCandidates() {
  const configured = process.env.VIDEO_GEMINI_MODEL?.trim() || process.env.GEMINI_MODEL?.trim();
  return Array.from(new Set([configured, DEFAULT_MODEL, ...FALLBACK_MODELS].filter(Boolean))) as string[];
}

type GeminiPayload = {
  candidates?: Array<{content?: {parts?: Array<{text?: unknown; thought?: unknown}>}}>;
  error?: {message?: unknown};
};

function responseText(payload: GeminiPayload) {
  return (payload.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => part.thought !== true && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
    .replace(/```(?:json)?/giu, "")
    .trim();
}

async function callStructuredGemini(system: string, input: string, responseSchema: Record<string, unknown>, maxOutputTokens: number) {
  if (!geminiKey()) throw new Error("Gemini chưa được cấu hình cho pipeline video.");
  let lastMessage = "";
  for (const model of modelCandidates()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55_000);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          signal: controller.signal,
          headers: {"content-type": "application/json", "x-goog-api-key": geminiKey()},
          body: JSON.stringify({
            systemInstruction: {parts: [{text: system}]},
            contents: [{role: "user", parts: [{text: input}]}],
            generationConfig: {temperature: 0, maxOutputTokens, responseMimeType: "application/json", responseSchema},
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as GeminiPayload;
      if (response.ok) {
        const text = responseText(payload);
        if (!text) throw new Error("Gemini trả về JSON rỗng.");
        return JSON.parse(text) as unknown;
      }
      lastMessage = typeof payload.error?.message === "string" ? payload.error.message.slice(0, 220) : `HTTP ${response.status}`;
      if (![404, 429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : "Không gọi được Gemini.";
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Gemini chưa tạo được nội dung video: ${lastMessage || "không rõ lỗi"}`);
}

function cleanText(value: string) {
  return value.replace(/\s+/gu, " ").replace(/(?:…|\.{3,})$/u, "").trim();
}

function splitWords(value: string, maxChars: number) {
  const words = cleanText(value).split(/\s+/gu).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = [current, word].filter(Boolean).join(" ");
    if (current && candidate.length > maxChars) {
      chunks.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function splitMeaningfulPhrases(value: string, maxChars = 105) {
  const normalized = cleanText(value);
  if (!normalized) return [];
  const clauses = normalized
    .split(/(?<=[,;:])\s+|\s+(?=(?:hoặc|đồng thời|nếu|khi|trường hợp|sau khi|trước khi)\b)/giu)
    .map((item) => cleanText(item).replace(/^[,;:]\s*/u, ""))
    .filter(Boolean);
  return clauses.flatMap((clause) => clause.length <= maxChars ? [clause] : splitWords(clause, maxChars));
}

function shortCompletePhrase(value: string, maxChars: number) {
  const text = cleanText(value);
  if (text.length <= maxChars) return text;
  const sentence = text.split(/(?<=[.!?])\s+/u).find((item) => item.length <= maxChars && item.length >= 20);
  if (sentence) return cleanText(sentence);
  const clause = splitMeaningfulPhrases(text, maxChars).find((item) => item.length >= 18);
  return clause || splitWords(text, maxChars)[0] || text;
}

export function captionChunksFromNarration(value: string, maxChars = 116) {
  const sentences = cleanText(value).split(/(?<=[.!?;:])\s+/gu).map(cleanText).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences.length ? sentences : [cleanText(value)]) {
    const pieces = sentence.length <= maxChars
      ? [sentence]
      : splitMeaningfulPhrases(sentence, maxChars).flatMap((piece) => piece.length <= maxChars ? [piece] : splitWords(piece, maxChars));
    for (const piece of pieces) {
      const candidate = [current, piece].filter(Boolean).join(" ");
      if (current && candidate.length > maxChars) {
        chunks.push(current);
        current = piece;
      } else current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

function normalizedTokens(value: string) {
  return new Set(normalizeVideoEvidence(value).replace(/[^a-z0-9à-ỹđ%]+/giu, " ").split(/\s+/gu).filter((token) => token.length > 2));
}

function textSimilarity(left: string, right: string) {
  const a = normalizedTokens(left);
  const b = normalizedTokens(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / Math.max(a.size, b.size);
}

function hasTruncation(value: string) {
  return /…|\.{3,}/u.test(value);
}

const EVIDENCE_SCHEMA = {
  type: "object",
  properties: {
    points: {
      type: "array", maxItems: 8,
      items: {
        type: "object",
        properties: {
          category: {type: "string", enum: CATEGORIES}, importance: {type: "integer", minimum: 1, maximum: 5},
          claim: {type: "string"}, sourceExcerpt: {type: "string"},
        },
        required: ["category", "importance", "claim", "sourceExcerpt"],
      },
    },
  },
  required: ["points"],
};

function validCategory(value: unknown): value is LegalVideoCategory {
  return typeof value === "string" && CATEGORIES.includes(value as LegalVideoCategory);
}

function fallbackCategory(sentence: string): LegalVideoCategory {
  if (/hiệu lực/iu.test(sentence)) return "effective";
  if (/thời hạn|ngày làm việc|chậm nhất/iu.test(sentence)) return "deadline";
  if (/\d+\s*%|\d[\d.,]*\s*(?:đồng|triệu|tỷ)|mức phạt/iu.test(sentence)) return "numbers";
  if (/hồ sơ|thủ tục|trình tự/iu.test(sentence)) return "procedure";
  if (/đối tượng|phạm vi|áp dụng đối với/iu.test(sentence)) return "scope";
  if (/sửa đổi|bổ sung|thay thế|bãi bỏ/iu.test(sentence)) return "changes";
  if (/phụ lục|mẫu số|biểu mẫu/iu.test(sentence)) return "forms";
  if (/chuyển tiếp/iu.test(sentence)) return "transition";
  if (/phải|trách nhiệm|nghĩa vụ/iu.test(sentence)) return "obligation";
  return "overview";
}

function fallbackEvidence(section: LegalVideoEvidenceSection) {
  const sentences = section.text.replace(/\s+/gu, " ").split(/(?<=[.!?;:])\s+/gu)
    .map((sentence) => sentence.trim()).filter((sentence) => sentence.length >= 35 && sentence.length <= 420).slice(0, 6);
  return sentences.map((sentence, index): LegalVideoEvidencePoint => ({
    id: `${section.id}-fallback-${index + 1}`,
    category: fallbackCategory(sentence), importance: index < 2 ? 4 : 3,
    claim: shortCompletePhrase(sentence, 155), sourceExcerpt: sentence,
    sectionId: section.id, provisionIds: section.provisionIds,
  }));
}

export async function summarizeVideoEvidenceSection(document: DocumentDetail, section: LegalVideoEvidenceSection): Promise<LegalVideoEvidencePoint[]> {
  if (!videoGeminiConfigured()) return fallbackEvidence(section);
  const raw = await callStructuredGemini(
    [
      "Bạn là biên tập viên pháp luật Việt Nam viết nội dung cho video giải thích, không phải bản chép lại văn bản.",
      "Chọn đủ các ý có tác động thực tế: ai chịu tác động, điều kiện nào, phải làm gì, thời hạn, số liệu, ngoại lệ và hệ quả.",
      "Mỗi claim chỉ trình bày một ý hoàn chỉnh, tối đa 150 ký tự, dùng tiếng Việt rõ ràng nhưng không thay đổi ý nghĩa pháp lý.",
      "Không dùng dấu ba chấm và không cắt câu giữa chừng.",
      "Ưu tiên cấu trúc: chủ thể – điều kiện – hành động hoặc hệ quả. Tránh mở đầu dài như 'theo quy định tại'.",
      "Không suy đoán. sourceExcerpt phải là đoạn nguyên văn liên tục trong nguồn, dài 25–360 ký tự.",
      "Giữ nguyên mọi điều kiện, ngoại lệ và số liệu. Không thêm số liệu hoặc kết luận không có trong sourceExcerpt.",
    ].join(" "),
    [`VĂN BẢN: ${document.number} — ${document.title}`, `PHẦN: ${section.heading}`, "", "NỘI DUNG NGUỒN:", section.text].join("\n"),
    EVIDENCE_SCHEMA, 3_200,
  ) as {points?: Array<Record<string, unknown>>};

  const points = (raw.points ?? []).flatMap((point, index): LegalVideoEvidencePoint[] => {
    const claim = typeof point.claim === "string" ? cleanText(point.claim) : "";
    const sourceExcerpt = typeof point.sourceExcerpt === "string" ? point.sourceExcerpt.trim() : "";
    if (!claim || claim.length > 165 || hasTruncation(claim) || !sourceExcerpt || !validCategory(point.category)) return [];
    if (!sourceContainsEvidence(section.text, sourceExcerpt)) return [];
    const allowed = normalizeVideoEvidence(sourceExcerpt);
    if (extractVideoNumberTokens(claim).some((token) => !allowed.includes(normalizeVideoEvidence(token)))) return [];
    const importance = Number(point.importance);
    return [{
      id: `${section.id}-point-${index + 1}`, category: point.category,
      importance: Math.max(1, Math.min(5, Number.isFinite(importance) ? Math.round(importance) : 3)) as 1 | 2 | 3 | 4 | 5,
      claim, sourceExcerpt, sectionId: section.id, provisionIds: section.provisionIds,
    }];
  });
  return points.length ? points : fallbackEvidence(section);
}

const GROUP_SCHEMA = {
  type: "object",
  properties: {groups: {type: "array", items: {type: "object", properties: {
    category: {type: "string", enum: CATEGORIES},
    evidencePointIds: {type: "array", minItems: 1, maxItems: 3, items: {type: "string"}},
    title: {type: "string"},
  }, required: ["category", "evidencePointIds", "title"]}}},
  required: ["groups"],
};

const SCENE_SCHEMA = {
  type: "object",
  properties: {scenes: {type: "array", maxItems: 20, items: {type: "object", properties: {
    category: {type: "string", enum: CATEGORIES},
    evidencePointIds: {type: "array", minItems: 1, maxItems: 3, items: {type: "string"}},
    title: {type: "string"}, bullets: {type: "array", minItems: 1, maxItems: 3, items: {type: "string"}},
    narration: {type: "string"},
  }, required: ["category", "evidencePointIds", "title", "bullets", "narration"]}}},
  required: ["scenes"],
};

function sceneKind(category: LegalVideoCategory): LegalVideoSceneKind {
  if (category === "scope") return "audience";
  if (category === "effective" || category === "deadline" || category === "transition") return "timeline";
  if (category === "procedure" || category === "forms") return "process";
  if (category === "numbers") return "numbers";
  if (category === "prepare" || category === "obligation") return "prepare";
  if (category === "changes") return "change";
  return "summary";
}

function visualMode(category: LegalVideoCategory, isFinal = false): LegalVideoVisualMode {
  if (isFinal) return "takeaways";
  if (category === "scope") return "network";
  if (category === "changes") return "contrast";
  if (category === "procedure" || category === "forms" || category === "transition") return "flow";
  if (category === "numbers") return "metric";
  if (category === "obligation" || category === "prepare") return "checklist";
  if (category === "deadline" || category === "effective") return "timeline";
  return "decision";
}

function categoryEyebrow(category: LegalVideoCategory) {
  const labels: Record<LegalVideoCategory, string> = {
    overview: "BỨC TRANH CHUNG", scope: "AI CHỊU TÁC ĐỘNG", changes: "ĐIỂM THAY ĐỔI",
    procedure: "DÒNG THỰC HIỆN", obligation: "TRÁCH NHIỆM", deadline: "MỐC PHẢI THEO DÕI",
    numbers: "CON SỐ TÁC ĐỘNG", effective: "MỐC THỜI GIAN", transition: "CÁCH CHUYỂN TIẾP",
    forms: "HỒ SƠ VÀ DỮ LIỆU", prepare: "VIỆC CẦN CHUẨN BỊ",
  };
  return labels[category];
}

function categoryFallbackTitle(category: LegalVideoCategory) {
  const labels: Record<LegalVideoCategory, string> = {
    overview: "Văn bản tác động đến cách quản lý như thế nào?", scope: "Ai chịu tác động trực tiếp?",
    changes: "Điểm nào làm thay đổi cách thực hiện?", procedure: "Quy trình cần đi qua những bước nào?",
    obligation: "Chủ thể phải thực hiện điều gì?", deadline: "Mốc nào không được bỏ qua?",
    numbers: "Con số nào ảnh hưởng trực tiếp?", effective: "Văn bản bắt đầu áp dụng từ khi nào?",
    transition: "Quy định chuyển tiếp được áp dụng thế nào?", forms: "Cần dùng hồ sơ hoặc dữ liệu nào?",
    prepare: "Cần chuẩn bị gì trước khi thực hiện?",
  };
  return labels[category];
}

function selectEvidence(points: LegalVideoEvidencePoint[], limit: number) {
  const selected: LegalVideoEvidencePoint[] = [];
  for (const category of CATEGORIES) {
    const first = points.filter((point) => point.category === category).sort((left, right) => right.importance - left.importance)[0];
    if (first) selected.push(first);
  }
  for (const point of [...points].sort((left, right) => right.importance - left.importance)) {
    if (selected.length >= limit) break;
    if (!selected.some((existing) => existing.id === point.id)) selected.push(point);
  }
  return selected;
}

function visualPhrases(points: LegalVideoEvidencePoint[], limit = 3) {
  const result: string[] = [];
  for (const point of points) {
    for (const rawPhrase of splitMeaningfulPhrases(point.claim, 104)) {
      const phrase = rawPhrase.replace(/^(?:và|hoặc|đồng thời)\s+/iu, "").trim();
      if (!phrase || result.some((item) => textSimilarity(item, phrase) > 0.8)) continue;
      result.push(phrase);
      if (result.length >= limit) return result;
    }
  }
  return result;
}

function safeTitle(value: string, category: LegalVideoCategory, points: LegalVideoEvidencePoint[]) {
  const candidate = cleanText(value);
  if (candidate.length >= 12 && candidate.length <= 78 && !hasTruncation(candidate) && !/[,;:]$/u.test(candidate)) return candidate;
  const fromClaim = shortCompletePhrase(points[0]?.claim || "", 72);
  if (fromClaim.length >= 12 && fromClaim.length <= 78 && !hasTruncation(fromClaim)) return fromClaim;
  return categoryFallbackTitle(category);
}

function removeTitleRepeats(title: string, bullets: string[]) {
  const unique: string[] = [];
  for (const bullet of bullets) {
    if (textSimilarity(title, bullet) >= 0.72) continue;
    if (unique.some((item) => textSimilarity(item, bullet) >= 0.82)) continue;
    unique.push(bullet);
  }
  return unique;
}

function groupDeterministically(points: LegalVideoEvidencePoint[], maxGroups: number) {
  const groups = new Map<LegalVideoCategory, LegalVideoEvidencePoint[]>();
  for (const point of points) {
    const current = groups.get(point.category) ?? [];
    if (current.length < 3) current.push(point);
    groups.set(point.category, current);
  }
  return [...groups.entries()].slice(0, maxGroups).map(([category, items]) => ({
    category, evidencePointIds: items.map((point) => point.id), title: shortCompletePhrase(items[0].claim, 72),
  }));
}

async function groupEvidenceForScenes(document: DocumentDetail, points: LegalVideoEvidencePoint[], length: LegalVideoLength) {
  const profile = videoLengthProfile(length);
  const fallback = groupDeterministically(points, profile.maxScenes - 2);
  if (!videoGeminiConfigured()) return fallback;
  try {
    const raw = await callStructuredGemini(
      [
        "Nhóm evidencePoint thành các cảnh video pháp luật có mạch kể chuyện.",
        "Mỗi cảnh trả lời một câu hỏi thực tế của người xem; không ghép các ý chỉ vì chúng đứng gần nhau trong văn bản.",
        "Sắp xếp theo mạch: bối cảnh, ai chịu tác động, điều kiện kích hoạt, dòng xử lý, số liệu hoặc thời hạn, kết quả cần đạt.",
        "title là một câu hoàn chỉnh tối đa 72 ký tự, không dùng dấu ba chấm và không chép lại toàn bộ claim.",
        "Loại bỏ ý trùng; giữ điều kiện và ngoại lệ quan trọng ở cùng cảnh; ưu tiên importance cao.",
      ].join(" "),
      JSON.stringify({
        target: {minGroups: Math.max(4, profile.minScenes - 3), maxGroups: profile.maxScenes - 2},
        document: {number: document.number, title: document.title},
        evidencePoints: points.map(({id, category, importance, claim}) => ({id, category, importance, claim})),
      }),
      GROUP_SCHEMA, 3_200,
    ) as {groups?: Array<Record<string, unknown>>};
    const pointMap = new Map(points.map((point) => [point.id, point]));
    const groups = (raw.groups ?? []).flatMap((group) => {
      if (!validCategory(group.category) || !Array.isArray(group.evidencePointIds)) return [];
      const ids = group.evidencePointIds.filter((id): id is string => typeof id === "string" && pointMap.has(id)).slice(0, 3);
      if (!ids.length) return [];
      return [{category: group.category, evidencePointIds: ids, title: typeof group.title === "string" ? cleanText(group.title) : ""}];
    }).slice(0, profile.maxScenes - 2);
    return groups.length >= Math.max(3, profile.minScenes - 4) ? groups : fallback;
  } catch {
    return fallback;
  }
}

function groundedText(value: string, points: LegalVideoEvidencePoint[]) {
  const allowed = normalizeVideoEvidence(points.map((point) => `${point.claim} ${point.sourceExcerpt}`).join(" "));
  return extractVideoNumberTokens(value).every((token) => allowed.includes(normalizeVideoEvidence(token)));
}

function buildScene(
  group: {category: LegalVideoCategory; evidencePointIds: string[]; title: string},
  index: number,
  pointMap: Map<string, LegalVideoEvidencePoint>,
  draft?: {title: string; bullets: string[]; narration: string},
): LegalVideoScene | null {
  const points = group.evidencePointIds.map((id) => pointMap.get(id)).filter(Boolean) as LegalVideoEvidencePoint[];
  if (!points.length) return null;
  const fallbackBullets = visualPhrases(points);
  const proposedBullets = draft?.bullets.flatMap((item) => splitMeaningfulPhrases(item, 112)) ?? fallbackBullets;
  const title = safeTitle(draft?.title || group.title, group.category, points);
  let bullets = removeTitleRepeats(title, proposedBullets).filter((item) => item.length <= 118 && !hasTruncation(item)).slice(0, 3);
  if (!bullets.length) bullets = removeTitleRepeats(title, fallbackBullets).slice(0, 3);
  if (!bullets.length) bullets = [shortCompletePhrase(points[0].claim, 110)];
  const narration = cleanText(draft?.narration || points.map((point) => point.claim).join(". "));
  return {
    id: `scene-${index + 2}`, category: group.category, kind: sceneKind(group.category), eyebrow: categoryEyebrow(group.category),
    title, subtitle: "", bullets, narration, captionChunks: captionChunksFromNarration(narration),
    evidencePointIds: points.map((point) => point.id), sourceExcerpt: points[0].sourceExcerpt,
    visualMode: visualMode(group.category), visualKeywords: visualPhrases(points, 4),
  };
}

async function draftViewerFriendlyScenes(
  document: DocumentDetail,
  groups: Array<{category: LegalVideoCategory; evidencePointIds: string[]; title: string}>,
  pointMap: Map<string, LegalVideoEvidencePoint>,
) {
  const fallback = groups.map((group, index) => buildScene(group, index, pointMap)).filter((scene): scene is LegalVideoScene => Boolean(scene));
  if (!videoGeminiConfigured() || !groups.length) return fallback;
  try {
    const selectedIds = new Set(groups.flatMap((group) => group.evidencePointIds));
    const selectedPoints = [...pointMap.values()].filter((point) => selectedIds.has(point.id));
    const raw = await callStructuredGemini(
      [
        "Bạn là đạo diễn nội dung cho video giải thích pháp luật, ưu tiên điều người xem cần hiểu, quyết định hoặc thực hiện.",
        "Mỗi cảnh chỉ có một ý chính và phải trả lời được một câu hỏi thực tế.",
        "title là câu hoàn chỉnh tối đa 72 ký tự; mỗi bullet là ý hoàn chỉnh tối đa 110 ký tự; tối đa 3 bullet.",
        "Không dùng dấu ba chấm, không cắt câu và không lặp title trong bullet.",
        "narration gồm 2–4 câu ngắn theo thứ tự: bối cảnh hoặc chủ thể – điều kiện – hành động – hệ quả hoặc lưu ý.",
        "Không chép nguyên đoạn pháp lý dài. Không thêm ví dụ, lời khuyên, số liệu hoặc kết luận ngoài evidence.",
        "Cảnh cuối không được dùng câu meta như 'giữ lại những ý quan trọng nhất'; nội dung phải nêu tác động hoặc việc cần kiểm tra cụ thể.",
      ].join(" "),
      JSON.stringify({
        document: {number: document.number, title: document.title}, groups,
        evidencePoints: selectedPoints.map(({id, category, importance, claim, sourceExcerpt}) => ({id, category, importance, claim, sourceExcerpt})),
      }),
      SCENE_SCHEMA, 5_000,
    ) as {scenes?: Array<Record<string, unknown>>};

    const drafted = new Map<string, {title: string; bullets: string[]; narration: string}>();
    for (const draft of raw.scenes ?? []) {
      if (!Array.isArray(draft.evidencePointIds) || !Array.isArray(draft.bullets)) continue;
      const ids = draft.evidencePointIds.filter((id): id is string => typeof id === "string" && selectedIds.has(id));
      if (!ids.length) continue;
      const title = typeof draft.title === "string" ? cleanText(draft.title) : "";
      const bullets = draft.bullets.filter((item): item is string => typeof item === "string").map(cleanText);
      const narration = typeof draft.narration === "string" ? cleanText(draft.narration) : "";
      if (!title || title.length > 82 || hasTruncation(title) || !bullets.length || !narration || hasTruncation(narration)) continue;
      drafted.set(ids.sort().join("|"), {title, bullets, narration});
    }

    const scenes = groups.flatMap((group, index) => {
      const key = [...group.evidencePointIds].sort().join("|");
      const draft = drafted.get(key);
      const points = group.evidencePointIds.map((id) => pointMap.get(id)).filter(Boolean) as LegalVideoEvidencePoint[];
      if (draft && ![draft.title, ...draft.bullets, draft.narration].every((value) => groundedText(value, points))) {
        return buildScene(group, index, pointMap) ?? [];
      }
      return buildScene(group, index, pointMap, draft) ?? [];
    });
    return scenes.length >= Math.max(3, Math.floor(fallback.length * 0.65)) ? scenes : fallback;
  } catch {
    return fallback;
  }
}

function introScene(document: DocumentDetail): LegalVideoScene {
  const subject = cleanText(document.title.replace(/^.*?quy định về\s*/iu, "").replace(/[.]$/u, ""));
  const narration = `${document.type} số ${document.number} quy định về ${subject}. Video tập trung vào các tác động, điều kiện và dòng thực hiện có ý nghĩa trực tiếp.`;
  return {
    id: "scene-1", kind: "intro", category: "overview", eyebrow: "VĂN BẢN TRONG 1 MẠCH KỂ",
    title: document.number, subtitle: shortCompletePhrase(document.title, 155), bullets: [], narration,
    captionChunks: captionChunksFromNarration(narration), evidencePointIds: [], sourceExcerpt: document.title,
    visualMode: "document", visualKeywords: [document.type, document.issuer, subject],
  };
}

function effectiveScene(document: DocumentDetail): LegalVideoScene | null {
  if (!document.effective_date && !document.issued_date) return null;
  const issued = document.issued_date ? document.issued_date.split("-").reverse().join("/") : null;
  const effective = document.effective_date ? document.effective_date.split("-").reverse().join("/") : null;
  const sameDate = Boolean(issued && effective && issued === effective);
  const bullets = sameDate ? [`Ban hành và có hiệu lực: ${issued}`] : [issued ? `Ban hành: ${issued}` : "", effective ? `Có hiệu lực: ${effective}` : ""].filter(Boolean);
  const narration = sameDate ? `Văn bản được ban hành và có hiệu lực cùng ngày ${issued}.` : [issued ? `Văn bản được ban hành ngày ${issued}.` : "", effective ? `Văn bản có hiệu lực từ ngày ${effective}.` : ""].filter(Boolean).join(" ");
  return {
    id: "scene-effective", kind: "timeline", category: "effective", eyebrow: "MỐC BẮT ĐẦU",
    title: sameDate ? `Áp dụng ngay từ ngày ban hành ${issued}` : effective ? `Bắt đầu áp dụng từ ${effective}` : "Mốc ban hành văn bản",
    subtitle: "", bullets, narration, captionChunks: captionChunksFromNarration(narration), evidencePointIds: [],
    sourceExcerpt: document.title, visualMode: "timeline", visualKeywords: bullets,
  };
}

function finalSummaryScene(points: LegalVideoEvidencePoint[]): LegalVideoScene | null {
  const priority: LegalVideoCategory[] = ["obligation", "procedure", "deadline", "forms", "transition", "changes", "scope", "numbers", "overview"];
  const selected: LegalVideoEvidencePoint[] = [];
  for (const category of priority) {
    const point = points.filter((item) => item.category === category).sort((left, right) => right.importance - left.importance)[0];
    if (point && !selected.some((item) => textSimilarity(item.claim, point.claim) > 0.78)) selected.push(point);
    if (selected.length === 3) break;
  }
  if (selected.length < 2) return null;
  const bullets = selected.map((point) => shortCompletePhrase(point.claim, 112));
  const actionable = selected.some((point) => ["obligation", "procedure", "forms", "prepare", "deadline"].includes(point.category));
  const title = actionable ? "Ba việc cần kiểm tra trước khi áp dụng" : "Ba tác động trực tiếp cần ghi nhớ";
  const narration = `Ba nội dung có tác động trực tiếp khi áp dụng văn bản gồm: ${selected.map((point) => cleanText(point.claim)).join(". ")}`;
  return {
    id: "scene-summary", kind: "summary", category: "overview", eyebrow: "KẾT LUẬN THỰC TẾ",
    title, subtitle: "", bullets, narration, captionChunks: captionChunksFromNarration(narration),
    evidencePointIds: selected.map((point) => point.id), sourceExcerpt: selected[0].sourceExcerpt,
    visualMode: "takeaways", visualKeywords: bullets,
  };
}

function uniqueSceneTitles(scenes: LegalVideoScene[]) {
  const seen = new Set<string>();
  return scenes.map((scene) => {
    const normalized = normalizeVideoEvidence(scene.title);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      return scene;
    }
    const replacement = categoryFallbackTitle(scene.category);
    const replacementKey = normalizeVideoEvidence(replacement);
    if (!seen.has(replacementKey)) {
      seen.add(replacementKey);
      return {...scene, title: replacement};
    }
    return scene;
  });
}

export async function createLegalVideoStoryboard(input: {
  document: DocumentDetail; points: LegalVideoEvidencePoint[]; length: LegalVideoLength; voice: LegalVideoVoice;
}): Promise<LegalVideoStoryboard> {
  const {document, length, voice} = input;
  const profile = videoLengthProfile(length);
  const repaired = repairVideoEvidenceCoverage(document, input.points);
  const unique = new Map<string, LegalVideoEvidencePoint>();
  for (const point of repaired) {
    const key = normalizeVideoEvidence(`${point.category}:${point.claim}`);
    if (!unique.has(key)) unique.set(key, point);
  }
  const selected = selectEvidence([...unique.values()], profile.maxEvidencePoints);
  const pointMap = new Map(selected.map((point) => [point.id, point]));
  const groups = await groupEvidenceForScenes(document, selected, length);
  const bodyScenes = await draftViewerFriendlyScenes(document, groups, pointMap);

  const covered = new Set(bodyScenes.map((scene) => scene.category));
  for (const category of new Set(selected.map((point) => point.category))) {
    if (covered.has(category) || bodyScenes.length >= profile.maxScenes - 2) continue;
    const point = selected.find((item) => item.category === category);
    if (!point) continue;
    const scene = buildScene({category, evidencePointIds: [point.id], title: point.claim}, bodyScenes.length, pointMap);
    if (scene) bodyScenes.push(scene);
    covered.add(category);
  }

  const effective = effectiveScene(document);
  const summary = finalSummaryScene(selected);
  const scenes = uniqueSceneTitles([
    introScene(document), ...(effective ? [effective] : []), ...bodyScenes, ...(summary ? [summary] : []),
  ].slice(0, profile.maxScenes).map((scene, index) => ({...scene, id: `scene-${index + 1}`})));
  const selectedPointIds = new Set(scenes.flatMap((scene) => scene.evidencePointIds));
  const detected = detectVideoCoverage(document);
  const coveredCategories = Array.from(new Set(scenes.map((scene) => scene.category)));
  const missing = detected.filter((category) => !coveredCategories.includes(category));

  return {
    version: 1, templateVersion: VIDEO_TEMPLATE_VERSION,
    document: {
      id: document.id, number: document.number, title: document.title, type: document.type, issuer: document.issuer,
      issued_date: document.issued_date, effective_date: document.effective_date, status: document.status,
    },
    length, voice, fps: 30, width: 1080, height: 1920, scenes,
    coverage: {
      detected, covered: coveredCategories, missing, evidencePointCount: selected.length,
      selectedPointCount: selectedPointIds.size,
      coverageScore: detected.length ? Number(((detected.length - missing.length) / detected.length).toFixed(3)) : 1,
    },
    createdAt: new Date().toISOString(),
  };
}