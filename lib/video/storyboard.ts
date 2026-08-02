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
  LegalVideoVoice,
} from "./types";

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const FALLBACK_MODELS = ["gemini-3.1-flash-lite", "gemini-3-flash-preview"] as const;
const CATEGORIES: LegalVideoCategory[] = [
  "overview",
  "scope",
  "changes",
  "procedure",
  "obligation",
  "deadline",
  "numbers",
  "effective",
  "transition",
  "forms",
  "prepare",
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

async function callStructuredGemini(
  system: string,
  input: string,
  responseSchema: Record<string, unknown>,
  maxOutputTokens: number,
) {
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
            generationConfig: {
              temperature: 0,
              maxOutputTokens,
              responseMimeType: "application/json",
              responseSchema,
            },
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as GeminiPayload;
      if (response.ok) {
        const text = responseText(payload);
        if (!text) throw new Error("Gemini trả về JSON rỗng.");
        return JSON.parse(text) as unknown;
      }
      lastMessage = typeof payload.error?.message === "string"
        ? payload.error.message.slice(0, 220)
        : `HTTP ${response.status}`;
      if (![404, 429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : "Không gọi được Gemini.";
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Gemini chưa tạo được nội dung video: ${lastMessage || "không rõ lỗi"}`);
}

function compactText(value: string, maxChars: number) {
  const text = value.replace(/\s+/gu, " ").trim();
  if (text.length <= maxChars) return text;
  const candidate = text.slice(0, maxChars + 1);
  const lastSpace = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, lastSpace > maxChars * 0.65 ? lastSpace : maxChars).trim()}…`;
}

function captionChunksFromNarration(value: string, maxChars = 145) {
  const sentences = value
    .replace(/\s+/gu, " ")
    .trim()
    .split(/(?<=[.!?;:])\s+/gu)
    .map((item) => item.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = [current, sentence].filter(Boolean).join(" ");
    if (current && candidate.length > maxChars) {
      chunks.push(compactText(current, maxChars));
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(compactText(current, maxChars));
  return chunks.length ? chunks : [compactText(value, maxChars)];
}

const EVIDENCE_SCHEMA = {
  type: "object",
  properties: {
    points: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          category: {type: "string", enum: CATEGORIES},
          importance: {type: "integer", minimum: 1, maximum: 5},
          claim: {type: "string"},
          sourceExcerpt: {type: "string"},
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
  const sentences = section.text
    .replace(/\s+/gu, " ")
    .split(/(?<=[.!?;:])\s+/gu)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 35 && sentence.length <= 420)
    .slice(0, 6);
  return sentences.map((sentence, index): LegalVideoEvidencePoint => ({
    id: `${section.id}-fallback-${index + 1}`,
    category: fallbackCategory(sentence),
    importance: index < 2 ? 4 : 3,
    claim: compactText(sentence, 155),
    sourceExcerpt: sentence,
    sectionId: section.id,
    provisionIds: section.provisionIds,
  }));
}

export async function summarizeVideoEvidenceSection(
  document: DocumentDetail,
  section: LegalVideoEvidenceSection,
): Promise<LegalVideoEvidencePoint[]> {
  if (!videoGeminiConfigured()) return fallbackEvidence(section);
  const raw = await callStructuredGemini(
    [
      "Bạn là biên tập viên pháp luật Việt Nam viết nội dung cho video giải thích, không phải bản chép lại văn bản.",
      "Chọn đủ các ý có tác động thực tế: ai chịu tác động, điều kiện nào, phải làm gì, thời hạn, số liệu, ngoại lệ và hệ quả.",
      "Mỗi claim chỉ trình bày một ý, tối đa khoảng 155 ký tự, dùng tiếng Việt rõ ràng nhưng không được làm thay đổi ý nghĩa pháp lý.",
      "Ưu tiên cấu trúc: chủ thể – điều kiện – hành động hoặc hệ quả. Tránh mở đầu dài như 'theo quy định tại'.",
      "Không suy đoán. sourceExcerpt phải là đoạn nguyên văn liên tục trong nguồn, dài 25–360 ký tự.",
      "Giữ nguyên mọi điều kiện, ngoại lệ và số liệu. Không thêm số liệu hoặc kết luận không có trong sourceExcerpt.",
    ].join(" "),
    [
      `VĂN BẢN: ${document.number} — ${document.title}`,
      `PHẦN: ${section.heading}`,
      "",
      "NỘI DUNG NGUỒN:",
      section.text,
    ].join("\n"),
    EVIDENCE_SCHEMA,
    3_200,
  ) as {points?: Array<Record<string, unknown>>};

  const points = (raw.points ?? []).flatMap((point, index): LegalVideoEvidencePoint[] => {
    const claim = typeof point.claim === "string" ? compactText(point.claim, 165) : "";
    const sourceExcerpt = typeof point.sourceExcerpt === "string" ? point.sourceExcerpt.trim() : "";
    if (!claim || !sourceExcerpt || !validCategory(point.category)) return [];
    if (!sourceContainsEvidence(section.text, sourceExcerpt)) return [];
    const allowed = normalizeVideoEvidence(sourceExcerpt);
    if (extractVideoNumberTokens(claim).some((token) => !allowed.includes(normalizeVideoEvidence(token)))) return [];
    const importance = Number(point.importance);
    return [{
      id: `${section.id}-point-${index + 1}`,
      category: point.category,
      importance: Math.max(1, Math.min(5, Number.isFinite(importance) ? Math.round(importance) : 3)) as 1 | 2 | 3 | 4 | 5,
      claim,
      sourceExcerpt,
      sectionId: section.id,
      provisionIds: section.provisionIds,
    }];
  });
  return points.length ? points : fallbackEvidence(section);
}

const GROUP_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: {type: "string", enum: CATEGORIES},
          evidencePointIds: {type: "array", minItems: 1, maxItems: 3, items: {type: "string"}},
          title: {type: "string"},
        },
        required: ["category", "evidencePointIds", "title"],
      },
    },
  },
  required: ["groups"],
};

const SCENE_SCHEMA = {
  type: "object",
  properties: {
    scenes: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          category: {type: "string", enum: CATEGORIES},
          evidencePointIds: {type: "array", minItems: 1, maxItems: 3, items: {type: "string"}},
          title: {type: "string"},
          bullets: {type: "array", minItems: 1, maxItems: 3, items: {type: "string"}},
          narration: {type: "string"},
        },
        required: ["category", "evidencePointIds", "title", "bullets", "narration"],
      },
    },
  },
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

function categoryEyebrow(category: LegalVideoCategory) {
  const labels: Record<LegalVideoCategory, string> = {
    overview: "TỔNG QUAN",
    scope: "AI CẦN QUAN TÂM",
    changes: "ĐIỂM CẦN LƯU Ý",
    procedure: "CÁCH THỰC HIỆN",
    obligation: "VIỆC PHẢI THỰC HIỆN",
    deadline: "THỜI HẠN",
    numbers: "SỐ LIỆU CẦN NHỚ",
    effective: "MỐC THỜI GIAN",
    transition: "GIAI ĐOẠN CHUYỂN TIẾP",
    forms: "HỒ SƠ VÀ BIỂU MẪU",
    prepare: "VIỆC CẦN CHUẨN BỊ",
  };
  return labels[category];
}

function selectEvidence(points: LegalVideoEvidencePoint[], limit: number) {
  const selected: LegalVideoEvidencePoint[] = [];
  for (const category of CATEGORIES) {
    const first = points
      .filter((point) => point.category === category)
      .sort((left, right) => right.importance - left.importance)[0];
    if (first) selected.push(first);
  }
  for (const point of [...points].sort((left, right) => right.importance - left.importance)) {
    if (selected.length >= limit) break;
    if (!selected.some((existing) => existing.id === point.id)) selected.push(point);
  }
  return selected;
}

function groupDeterministically(points: LegalVideoEvidencePoint[], maxGroups: number) {
  const groups = new Map<LegalVideoCategory, LegalVideoEvidencePoint[]>();
  for (const point of points) {
    const current = groups.get(point.category) ?? [];
    if (current.length < 3) current.push(point);
    groups.set(point.category, current);
  }
  return [...groups.entries()].slice(0, maxGroups).map(([category, items]) => ({
    category,
    evidencePointIds: items.map((point) => point.id),
    title: compactText(items[0].claim, 88),
  }));
}

async function groupEvidenceForScenes(
  document: DocumentDetail,
  points: LegalVideoEvidencePoint[],
  length: LegalVideoLength,
) {
  const profile = videoLengthProfile(length);
  const fallback = groupDeterministically(points, profile.maxScenes - 2);
  if (!videoGeminiConfigured()) return fallback;
  try {
    const raw = await callStructuredGemini(
      [
        "Nhóm evidencePoint thành các cảnh video pháp luật dễ theo dõi.",
        "Mỗi cảnh chỉ tập trung vào một câu hỏi hoặc một ý chính; không ghép các ý không liên quan chỉ vì cùng xuất hiện trong văn bản.",
        "Sắp xếp theo mạch: văn bản nói về gì, ai cần quan tâm, quy tắc quan trọng, quy trình hoặc số liệu, mốc thời gian, việc cần làm.",
        "Loại bỏ ý trùng. Chỉ trả về category, evidencePointIds đã có và title ngắn tối đa khoảng 88 ký tự.",
        "Giữ điều kiện và ngoại lệ quan trọng ở cùng cảnh; ưu tiên importance cao.",
      ].join(" "),
      JSON.stringify({
        target: {
          minGroups: Math.max(4, profile.minScenes - 3),
          maxGroups: profile.maxScenes - 2,
        },
        document: {number: document.number, title: document.title},
        evidencePoints: points.map(({id, category, importance, claim}) => ({id, category, importance, claim})),
      }),
      GROUP_SCHEMA,
      3_200,
    ) as {groups?: Array<Record<string, unknown>>};
    const pointMap = new Map(points.map((point) => [point.id, point]));
    const groups = (raw.groups ?? []).flatMap((group) => {
      if (!validCategory(group.category) || !Array.isArray(group.evidencePointIds)) return [];
      const ids = group.evidencePointIds
        .filter((id): id is string => typeof id === "string" && pointMap.has(id))
        .slice(0, 3);
      if (!ids.length) return [];
      return [{
        category: group.category,
        evidencePointIds: ids,
        title: typeof group.title === "string" ? compactText(group.title, 88) : "",
      }];
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

function sceneFromGroup(
  group: {category: LegalVideoCategory; evidencePointIds: string[]; title: string},
  index: number,
  pointMap: Map<string, LegalVideoEvidencePoint>,
): LegalVideoScene | null {
  const points = group.evidencePointIds.map((id) => pointMap.get(id)).filter(Boolean) as LegalVideoEvidencePoint[];
  if (!points.length) return null;
  const bullets = points.map((point) => compactText(point.claim, 135)).slice(0, 3);
  const proposedTitle = group.title || bullets[0];
  const safeTitle = groundedText(proposedTitle, points) ? proposedTitle : bullets[0];
  const narration = bullets.join(". ");
  return {
    id: `scene-${index + 2}`,
    category: group.category,
    kind: sceneKind(group.category),
    eyebrow: categoryEyebrow(group.category),
    title: compactText(safeTitle, 88),
    subtitle: "",
    bullets,
    narration,
    captionChunks: captionChunksFromNarration(narration),
    evidencePointIds: points.map((point) => point.id),
    sourceExcerpt: points[0].sourceExcerpt,
  };
}

async function draftViewerFriendlyScenes(
  document: DocumentDetail,
  groups: Array<{category: LegalVideoCategory; evidencePointIds: string[]; title: string}>,
  pointMap: Map<string, LegalVideoEvidencePoint>,
) {
  const fallback = groups
    .map((group, index) => sceneFromGroup(group, index, pointMap))
    .filter((scene): scene is LegalVideoScene => Boolean(scene));
  if (!videoGeminiConfigured() || !groups.length) return fallback;

  try {
    const selectedIds = new Set(groups.flatMap((group) => group.evidencePointIds));
    const selectedPoints = [...pointMap.values()].filter((point) => selectedIds.has(point.id));
    const raw = await callStructuredGemini(
      [
        "Bạn biên tập kịch bản video pháp luật theo hướng dễ hiểu, chính xác và có tính hướng dẫn.",
        "Mỗi cảnh chỉ có một ý chính. title tối đa khoảng 88 ký tự; mỗi bullet tối đa khoảng 125 ký tự; tối đa 3 bullet.",
        "narration gồm 2–4 câu ngắn, diễn giải theo thứ tự: ai hoặc vấn đề gì – điều kiện – phải làm gì – hệ quả hoặc lưu ý.",
        "Không chép nguyên đoạn pháp lý dài. Dùng từ phổ thông nhưng không được làm thay đổi chủ thể, điều kiện, ngoại lệ, thời hạn hoặc hệ quả pháp lý.",
        "Không đưa ra lời khuyên vượt quá nguồn, không thêm ví dụ giả định, không thêm số liệu và không gộp các nhóm evidence ngoài danh sách đã giao.",
        "Tránh lặp title trong bullet và tránh lặp cùng một ý ở nhiều cảnh.",
      ].join(" "),
      JSON.stringify({
        document: {number: document.number, title: document.title},
        groups,
        evidencePoints: selectedPoints.map(({id, category, importance, claim, sourceExcerpt}) => ({
          id,
          category,
          importance,
          claim,
          sourceExcerpt,
        })),
      }),
      SCENE_SCHEMA,
      5_000,
    ) as {scenes?: Array<Record<string, unknown>>};

    const scenes = (raw.scenes ?? []).flatMap((draft, index): LegalVideoScene[] => {
      if (!validCategory(draft.category) || !Array.isArray(draft.evidencePointIds) || !Array.isArray(draft.bullets)) return [];
      const ids = draft.evidencePointIds
        .filter((id): id is string => typeof id === "string" && pointMap.has(id) && selectedIds.has(id))
        .slice(0, 3);
      const points = ids.map((id) => pointMap.get(id)).filter(Boolean) as LegalVideoEvidencePoint[];
      if (!points.length) return [];
      const title = typeof draft.title === "string" ? compactText(draft.title, 88) : "";
      const bullets = draft.bullets
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => compactText(item, 135))
        .slice(0, 3);
      const narration = typeof draft.narration === "string" ? compactText(draft.narration, 420) : "";
      if (!title || !bullets.length || !narration) return [];
      if (![title, ...bullets, narration].every((value) => groundedText(value, points))) return [];
      return [{
        id: `scene-${index + 2}`,
        category: draft.category,
        kind: sceneKind(draft.category),
        eyebrow: categoryEyebrow(draft.category),
        title,
        subtitle: "",
        bullets,
        narration,
        captionChunks: captionChunksFromNarration(narration),
        evidencePointIds: ids,
        sourceExcerpt: points[0].sourceExcerpt,
      }];
    });
    return scenes.length >= Math.max(3, Math.floor(fallback.length * 0.65)) ? scenes : fallback;
  } catch {
    return fallback;
  }
}

function introScene(document: DocumentDetail): LegalVideoScene {
  const narration = `${document.type} số ${document.number} quy định về ${document.title.replace(/^.*?quy định về\s*/iu, "").replace(/[.]$/u, "")}. Video này tập trung vào các nội dung có ảnh hưởng thực tế và những việc cần lưu ý.`;
  return {
    id: "scene-1",
    kind: "intro",
    category: "overview",
    eyebrow: "VĂN BẢN MỚI",
    title: document.number,
    subtitle: compactText(document.title, 175),
    bullets: [],
    narration: compactText(narration, 360),
    captionChunks: captionChunksFromNarration(narration),
    evidencePointIds: [],
    sourceExcerpt: document.title,
  };
}

function effectiveScene(document: DocumentDetail): LegalVideoScene | null {
  if (!document.effective_date && !document.issued_date) return null;
  const issued = document.issued_date ? document.issued_date.split("-").reverse().join("/") : null;
  const effective = document.effective_date ? document.effective_date.split("-").reverse().join("/") : null;
  const sameDate = Boolean(issued && effective && issued === effective);
  const bullets = sameDate
    ? [`Ban hành và có hiệu lực: ${issued}`]
    : [issued ? `Ban hành: ${issued}` : "", effective ? `Có hiệu lực: ${effective}` : ""].filter(Boolean);
  const narration = sameDate
    ? `Văn bản được ban hành và có hiệu lực cùng ngày ${issued}.`
    : [issued ? `Văn bản được ban hành ngày ${issued}.` : "", effective ? `Văn bản có hiệu lực từ ngày ${effective}.` : ""].filter(Boolean).join(" ");
  return {
    id: "scene-effective",
    kind: "timeline",
    category: "effective",
    eyebrow: "MỐC THỜI GIAN",
    title: sameDate ? `Ban hành và có hiệu lực từ ${issued}` : effective ? `Có hiệu lực từ ${effective}` : "Mốc ban hành văn bản",
    subtitle: sameDate ? "" : issued ? `Ban hành ngày ${issued}` : "",
    bullets,
    narration,
    captionChunks: captionChunksFromNarration(narration),
    evidencePointIds: [],
    sourceExcerpt: document.title,
  };
}

function finalSummaryScene(points: LegalVideoEvidencePoint[]): LegalVideoScene | null {
  const selected: LegalVideoEvidencePoint[] = [];
  for (const point of [...points].sort((left, right) => right.importance - left.importance)) {
    if (selected.some((item) => item.category === point.category)) continue;
    selected.push(point);
    if (selected.length === 3) break;
  }
  if (selected.length < 2) return null;
  const bullets = selected.map((point) => compactText(point.claim, 125));
  const narration = `Tóm lại, có ${selected.length} điểm cần nhớ. ${bullets.join(". ")}`;
  return {
    id: "scene-summary",
    kind: "summary",
    category: "overview",
    eyebrow: "TÓM TẮT",
    title: "Những điểm cần nhớ sau khi xem",
    subtitle: "",
    bullets,
    narration,
    captionChunks: captionChunksFromNarration(narration),
    evidencePointIds: selected.map((point) => point.id),
    sourceExcerpt: selected[0].sourceExcerpt,
  };
}

export async function createLegalVideoStoryboard(input: {
  document: DocumentDetail;
  points: LegalVideoEvidencePoint[];
  length: LegalVideoLength;
  voice: LegalVideoVoice;
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
  let bodyScenes = await draftViewerFriendlyScenes(document, groups, pointMap);

  const covered = new Set(bodyScenes.map((scene) => scene.category));
  for (const category of new Set(selected.map((point) => point.category))) {
    if (covered.has(category) || bodyScenes.length >= profile.maxScenes - 2) continue;
    const point = selected.find((item) => item.category === category);
    if (!point) continue;
    const scene = sceneFromGroup(
      {category, evidencePointIds: [point.id], title: point.claim},
      bodyScenes.length,
      pointMap,
    );
    if (scene) bodyScenes.push(scene);
    covered.add(category);
  }

  const effective = effectiveScene(document);
  const summary = finalSummaryScene(selected);
  const scenes = [introScene(document), ...(effective ? [effective] : []), ...bodyScenes, ...(summary ? [summary] : [])]
    .slice(0, profile.maxScenes)
    .map((scene, index) => ({...scene, id: `scene-${index + 1}`}));
  const selectedPointIds = new Set(scenes.flatMap((scene) => scene.evidencePointIds));
  const detected = detectVideoCoverage(document);
  const coveredCategories = Array.from(new Set(scenes.map((scene) => scene.category)));
  const missing = detected.filter((category) => !coveredCategories.includes(category));

  return {
    version: 1,
    templateVersion: VIDEO_TEMPLATE_VERSION,
    document: {
      id: document.id,
      number: document.number,
      title: document.title,
      type: document.type,
      issuer: document.issuer,
      issued_date: document.issued_date,
      effective_date: document.effective_date,
      status: document.status,
    },
    length,
    voice,
    fps: 30,
    width: 1080,
    height: 1920,
    scenes,
    coverage: {
      detected,
      covered: coveredCategories,
      missing,
      evidencePointCount: selected.length,
      selectedPointCount: selectedPointIds.size,
      coverageScore: detected.length ? Number(((detected.length - missing.length) / detected.length).toFixed(3)) : 1,
    },
    createdAt: new Date().toISOString(),
  };
}
