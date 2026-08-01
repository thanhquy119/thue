import type {DocumentDetail} from "@/lib/legal/types";
import {
  detectVideoCoverage,
  extractVideoNumberTokens,
  normalizeVideoEvidence,
  sourceContainsEvidence,
  validateGroundedScene,
  videoLengthProfile,
  VIDEO_TEMPLATE_VERSION,
} from "./chunking";
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

const EVIDENCE_SCHEMA = {
  type: "object",
  properties: {
    points: {
      type: "array",
      maxItems: 7,
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

function evidencePrompt(document: DocumentDetail, section: LegalVideoEvidenceSection) {
  return [
    `VĂN BẢN: ${document.number} — ${document.title}`,
    `PHẦN: ${section.heading}`,
    "",
    "NỘI DUNG NGUỒN:",
    section.text,
  ].join("\n");
}

function validCategory(value: unknown): value is LegalVideoCategory {
  return typeof value === "string" && CATEGORIES.includes(value as LegalVideoCategory);
}

function fallbackEvidence(section: LegalVideoEvidenceSection) {
  const sentences = section.text
    .replace(/\s+/gu, " ")
    .split(/(?<=[.!?;:])\s+/gu)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 45 && sentence.length <= 360)
    .slice(0, 4);
  return sentences.map((sentence, index): LegalVideoEvidencePoint => ({
    id: `${section.id}-fallback-${index + 1}`,
    category: /hiệu lực/iu.test(sentence)
      ? "effective"
      : /thời hạn|ngày làm việc|chậm nhất/iu.test(sentence)
        ? "deadline"
        : /hồ sơ|thủ tục|trình tự/iu.test(sentence)
          ? "procedure"
          : /đối tượng|phạm vi/iu.test(sentence)
            ? "scope"
            : /phải|trách nhiệm|nghĩa vụ/iu.test(sentence)
              ? "obligation"
              : "overview",
    importance: index === 0 ? 4 : 3,
    claim: sentence,
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
      "Bạn là biên tập viên pháp luật Việt Nam.",
      "Chỉ chọn các ý có tác động thực tế hoặc giúp hiểu đúng phạm vi, nghĩa vụ, thủ tục, thời hạn, số liệu, hiệu lực và chuyển tiếp.",
      "Không suy đoán. sourceExcerpt phải được chép nguyên văn liên tục từ NỘI DUNG NGUỒN, dài 25–320 ký tự.",
      "claim phải ngắn, rõ, giữ nguyên điều kiện và ngoại lệ quan trọng. Không thêm số liệu không có trong sourceExcerpt.",
    ].join(" "),
    evidencePrompt(document, section),
    EVIDENCE_SCHEMA,
    2_600,
  ) as {points?: Array<Record<string, unknown>>};

  const points = (raw.points ?? []).flatMap((point, index): LegalVideoEvidencePoint[] => {
    const claim = typeof point.claim === "string" ? point.claim.trim() : "";
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

const SCENE_SCHEMA = {
  type: "object",
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: {type: "string", enum: CATEGORIES},
          kind: {type: "string", enum: ["timeline", "audience", "change", "process", "numbers", "prepare", "summary"]},
          eyebrow: {type: "string"},
          title: {type: "string"},
          subtitle: {type: "string"},
          bullets: {type: "array", maxItems: 3, items: {type: "string"}},
          narration: {type: "string"},
          captionChunks: {type: "array", minItems: 1, maxItems: 4, items: {type: "string"}},
          evidencePointIds: {type: "array", minItems: 1, maxItems: 4, items: {type: "string"}},
        },
        required: ["category", "kind", "eyebrow", "title", "bullets", "narration", "captionChunks", "evidencePointIds"],
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
    scope: "ĐỐI TƯỢNG ÁP DỤNG",
    changes: "ĐIỂM ĐÁNG CHÚ Ý",
    procedure: "HỒ SƠ VÀ THỦ TỤC",
    obligation: "NGHĨA VỤ CẦN THỰC HIỆN",
    deadline: "THỜI HẠN",
    numbers: "MỨC TIỀN VÀ TỶ LỆ",
    effective: "HIỆU LỰC",
    transition: "QUY ĐỊNH CHUYỂN TIẾP",
    forms: "BIỂU MẪU VÀ PHỤ LỤC",
    prepare: "VIỆC CẦN CHUẨN BỊ",
  };
  return labels[category];
}

function groupSelectedPoints(points: LegalVideoEvidencePoint[], limit: number) {
  const byCategory = new Map<LegalVideoCategory, LegalVideoEvidencePoint[]>();
  for (const point of [...points].sort((a, b) => b.importance - a.importance)) {
    const group = byCategory.get(point.category) ?? [];
    if (group.length < 3) group.push(point);
    byCategory.set(point.category, group);
  }
  const selected: LegalVideoEvidencePoint[] = [];
  for (const category of CATEGORIES) {
    const first = byCategory.get(category)?.[0];
    if (first) selected.push(first);
  }
  const remaining = [...points]
    .filter((point) => !selected.some((chosen) => chosen.id === point.id))
    .sort((a, b) => b.importance - a.importance);
  for (const point of remaining) {
    if (selected.length >= limit) break;
    selected.push(point);
  }
  return selected;
}

function fallbackScenes(points: LegalVideoEvidencePoint[], maxScenes: number) {
  const groups = new Map<LegalVideoCategory, LegalVideoEvidencePoint[]>();
  for (const point of points) {
    const group = groups.get(point.category) ?? [];
    if (group.length < 3) group.push(point);
    groups.set(point.category, group);
  }
  return [...groups.entries()].slice(0, maxScenes).map(([category, group], index): LegalVideoScene => {
    const first = group[0];
    const bullets = group.map((point) => point.claim).slice(0, 3);
    return {
      id: `scene-${index + 2}`,
      category,
      kind: sceneKind(category),
      eyebrow: categoryEyebrow(category),
      title: first.claim.slice(0, 100),
      subtitle: "",
      bullets,
      narration: bullets.join(". "),
      captionChunks: bullets,
      evidencePointIds: group.map((point) => point.id),
      sourceExcerpt: first.sourceExcerpt,
    };
  });
}

function scenePrompt(document: DocumentDetail, points: LegalVideoEvidencePoint[], length: LegalVideoLength) {
  const profile = videoLengthProfile(length);
  return JSON.stringify({
    document: {
      number: document.number,
      title: document.title,
      type: document.type,
      issuer: document.issuer,
      issuedDate: document.issued_date,
      effectiveDate: document.effective_date,
    },
    target: {
      length,
      targetSeconds: profile.targetSeconds,
      minScenesExcludingIntro: Math.max(4, profile.minScenes - 1),
      maxScenesExcludingIntro: profile.maxScenes - 1,
    },
    evidencePoints: points.map(({id, category, importance, claim, sourceExcerpt}) => ({
      id,
      category,
      importance,
      claim,
      sourceExcerpt,
    })),
  });
}

function sanitizeScene(
  raw: Record<string, unknown>,
  index: number,
  pointMap: Map<string, LegalVideoEvidencePoint>,
  documentSource: string,
): LegalVideoScene | null {
  const ids = Array.isArray(raw.evidencePointIds)
    ? raw.evidencePointIds.filter((id): id is string => typeof id === "string" && pointMap.has(id)).slice(0, 4)
    : [];
  if (!ids.length || !validCategory(raw.category)) return null;
  const points = ids.map((id) => pointMap.get(id)).filter(Boolean) as LegalVideoEvidencePoint[];
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const narration = typeof raw.narration === "string" ? raw.narration.trim() : "";
  if (!title || !narration) return null;
  const allowedKinds: LegalVideoSceneKind[] = ["timeline", "audience", "change", "process", "numbers", "prepare", "summary"];
  const kind = typeof raw.kind === "string" && allowedKinds.includes(raw.kind as LegalVideoSceneKind)
    ? raw.kind as LegalVideoSceneKind
    : sceneKind(raw.category);
  const scene: LegalVideoScene = {
    id: `scene-${index + 2}`,
    category: raw.category,
    kind,
    eyebrow: typeof raw.eyebrow === "string" && raw.eyebrow.trim()
      ? raw.eyebrow.trim().slice(0, 70)
      : categoryEyebrow(raw.category),
    title: title.slice(0, 120),
    subtitle: typeof raw.subtitle === "string" ? raw.subtitle.trim().slice(0, 160) : "",
    bullets: Array.isArray(raw.bullets)
      ? raw.bullets.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, 170)).slice(0, 3)
      : [],
    narration: narration.slice(0, 1_300),
    captionChunks: Array.isArray(raw.captionChunks)
      ? raw.captionChunks.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, 180)).slice(0, 4)
      : [narration.slice(0, 180)],
    evidencePointIds: ids,
    sourceExcerpt: points[0].sourceExcerpt,
  };
  const allowedEvidence = points.map((point) => `${point.claim}\n${point.sourceExcerpt}`).join("\n");
  if (extractVideoNumberTokens([scene.title, scene.subtitle, ...scene.bullets, scene.narration].join(" "))
    .some((token) => !normalizeVideoEvidence(`${allowedEvidence}\n${documentSource}`).includes(normalizeVideoEvidence(token)))) {
    return null;
  }
  return validateGroundedScene(scene, documentSource).length ? null : scene;
}

function introScene(document: DocumentDetail): LegalVideoScene {
  return {
    id: "scene-1",
    kind: "intro",
    category: "overview",
    eyebrow: "VĂN BẢN MỚI",
    title: document.number,
    subtitle: document.title.slice(0, 180),
    bullets: [],
    narration: `${document.type} số ${document.number}. Sau đây là những nội dung chính cần nắm.`,
    captionChunks: [document.number, "Những nội dung chính cần nắm"],
    evidencePointIds: [],
    sourceExcerpt: document.title,
  };
}

function effectiveScene(document: DocumentDetail): LegalVideoScene | null {
  if (!document.effective_date && !document.issued_date) return null;
  const issued = document.issued_date ? document.issued_date.split("-").reverse().join("/") : null;
  const effective = document.effective_date ? document.effective_date.split("-").reverse().join("/") : null;
  const bullets = [issued ? `Ban hành: ${issued}` : "", effective ? `Có hiệu lực: ${effective}` : ""].filter(Boolean);
  return {
    id: "scene-effective",
    kind: "timeline",
    category: "effective",
    eyebrow: "MỐC THỜI GIAN",
    title: effective ? `Có hiệu lực từ ${effective}` : "Mốc ban hành văn bản",
    subtitle: issued ? `Ban hành ngày ${issued}` : "",
    bullets,
    narration: [issued ? `Văn bản được ban hành ngày ${issued}.` : "", effective ? `Văn bản có hiệu lực từ ngày ${effective}.` : ""].filter(Boolean).join(" "),
    captionChunks: bullets,
    evidencePointIds: [],
    sourceExcerpt: document.title,
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
  const source = `${document.title}\n${document.number}\n${document.issued_date ?? ""}\n${document.effective_date ?? ""}\n${document.official_text}`;
  const unique = new Map<string, LegalVideoEvidencePoint>();
  for (const point of input.points) {
    const key = normalizeVideoEvidence(`${point.category}:${point.claim}`);
    if (!unique.has(key)) unique.set(key, point);
  }
  const selected = groupSelectedPoints([...unique.values()], profile.maxEvidencePoints);
  const pointMap = new Map(selected.map((point) => [point.id, point]));
  let bodyScenes: LegalVideoScene[] = [];

  if (videoGeminiConfigured() && selected.length) {
    try {
      const raw = await callStructuredGemini(
        [
          "Bạn đang dựng storyboard video tóm tắt văn bản pháp luật bằng tiếng Việt.",
          "Chỉ dùng evidencePoints được cung cấp. Mỗi cảnh phải ghi đúng evidencePointIds làm căn cứ.",
          "Không thêm nghĩa vụ, con số, ngày tháng hoặc lợi ích chưa có trong evidencePoints.",
          "Giữ đầy đủ điều kiện, ngoại lệ quan trọng; ưu tiên các ý importance cao và bảo đảm mỗi category đang có dữ liệu xuất hiện ít nhất một lần.",
          "Mỗi cảnh có tối đa 3 bullet, lời đọc tự nhiên 1–4 câu, captionChunks ngắn và không hiện chữ nguồn hay lời cảnh báo.",
        ].join(" "),
        scenePrompt(document, selected, length),
        SCENE_SCHEMA,
        length === "detailed" ? 7_500 : 5_000,
      ) as {scenes?: Array<Record<string, unknown>>};
      bodyScenes = (raw.scenes ?? [])
        .map((scene, index) => sanitizeScene(scene, index, pointMap, source))
        .filter((scene): scene is LegalVideoScene => Boolean(scene))
        .slice(0, profile.maxScenes - 1);
    } catch {
      bodyScenes = [];
    }
  }

  if (bodyScenes.length < Math.max(3, profile.minScenes - 2)) {
    bodyScenes = fallbackScenes(selected, profile.maxScenes - 1);
  }

  const covered = new Set(bodyScenes.map((scene) => scene.category));
  for (const category of new Set(selected.map((point) => point.category))) {
    if (covered.has(category) || bodyScenes.length >= profile.maxScenes - 1) continue;
    const point = selected.find((item) => item.category === category);
    if (!point) continue;
    bodyScenes.push(...fallbackScenes([point], 1).map((scene) => ({...scene, id: `scene-${bodyScenes.length + 2}`})));
    covered.add(category);
  }

  const effective = effectiveScene(document);
  const scenes = [introScene(document), ...(effective ? [effective] : []), ...bodyScenes]
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
