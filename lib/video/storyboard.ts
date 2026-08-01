export type LegalVideoScene = {
  id: string;
  heading: string;
  narration: string;
  bullets: string[];
  sourceExcerpt: string;
  durationSeconds: number;
  mermaid?: string;
};

export type LegalVideoPlan = {
  version: 1;
  title: string;
  subtitle: string;
  summary: string;
  format: "vertical" | "landscape";
  scenes: LegalVideoScene[];
  disclaimer: string;
};

export const VIDEO_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "integer", enum: [1] },
    title: { type: "string", minLength: 1, maxLength: 140 },
    subtitle: { type: "string", minLength: 1, maxLength: 180 },
    summary: { type: "string", minLength: 1, maxLength: 500 },
    format: { type: "string", enum: ["vertical", "landscape"] },
    scenes: {
      type: "array",
      minItems: 3,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1, maxLength: 40 },
          heading: { type: "string", minLength: 1, maxLength: 90 },
          narration: { type: "string", minLength: 1, maxLength: 700 },
          bullets: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: { type: "string", minLength: 1, maxLength: 220 },
          },
          sourceExcerpt: { type: "string", minLength: 1, maxLength: 500 },
          durationSeconds: { type: "number", minimum: 4, maximum: 35 },
          mermaid: { type: "string", maxLength: 1200 },
        },
        required: ["id", "heading", "narration", "bullets", "sourceExcerpt", "durationSeconds"],
      },
    },
    disclaimer: { type: "string", minLength: 1, maxLength: 300 },
  },
  required: ["version", "title", "subtitle", "summary", "format", "scenes", "disclaimer"],
} as const;

const PRIORITY_RULES: Array<{ heading: string; pattern: RegExp; score: number }> = [
  { heading: "Hiệu lực và chuyển tiếp", pattern: /có hiệu lực|hiệu lực thi hành|bãi bỏ|thay thế|chuyển tiếp/iu, score: 12 },
  { heading: "Thời hạn và mốc cần nhớ", pattern: /thời hạn|chậm nhất|trước ngày|kể từ ngày|trong vòng|ngày\s+\d/iu, score: 11 },
  { heading: "Đối tượng áp dụng", pattern: /đối tượng áp dụng|áp dụng đối với|người nộp thuế|tổ chức|cá nhân/iu, score: 10 },
  { heading: "Nghĩa vụ và thủ tục", pattern: /phải|có trách nhiệm|thực hiện|kê khai|nộp|đăng ký|hồ sơ|thủ tục/iu, score: 9 },
  { heading: "Mức tiền và tỷ lệ", pattern: /\d[\d.,]*\s*(?:%|đồng|triệu|tỷ)|mức thu|thuế suất|tỷ lệ/iu, score: 8 },
  { heading: "Điểm mới đáng chú ý", pattern: /sửa đổi|bổ sung|quy định mới|thay đổi|điều chỉnh/iu, score: 7 },
];

function normalizeText(value: string) {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t\u00a0]+/gu, " ")
    .replace(/[ ]{2,}/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function clip(value: string, maximum: number) {
  const text = value.trim();
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function sentenceList(value: string) {
  return normalizeText(value)
    .replace(/\n+/gu, " ")
    .split(/(?<=[.!?;:])\s+(?=[\p{Lu}Đ\d])/gu)
    .map((sentence) => sentence.replace(/\s+/gu, " ").trim())
    .filter((sentence) => sentence.length >= 35)
    .slice(0, 240);
}

function firstTitle(value: string) {
  const line = normalizeText(value)
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.length >= 8 && item.length <= 180);
  return clip(line || "Tóm tắt văn bản pháp luật thuế", 140);
}

function durationFor(text: string) {
  const words = text.split(/\s+/u).filter(Boolean).length;
  return Math.max(6, Math.min(28, Math.round(words / 2.35 + 2)));
}

function bulletsFor(sentence: string) {
  const parts = sentence
    .split(/;|,\s+(?=(?:đồng thời|trong đó|bao gồm|trừ trường hợp|kể từ|đối với)\b)/iu)
    .map((item) => clip(item.trim(), 190))
    .filter((item) => item.length >= 12);
  return (parts.length ? parts : [clip(sentence, 190)]).slice(0, 3);
}

function headingAndScore(sentence: string, index: number) {
  let heading = "Nội dung quan trọng";
  let score = Math.max(0, 5 - index / 30);
  for (const rule of PRIORITY_RULES) {
    if (!rule.pattern.test(sentence)) continue;
    if (rule.score > score) heading = rule.heading;
    score = Math.max(score, rule.score);
  }
  if (/^Điều\s+\d+/iu.test(sentence)) score += 1.5;
  if (/\d/u.test(sentence)) score += 0.6;
  return { heading, score };
}

export function buildFallbackVideoPlan(input: string, requestedTitle?: string): LegalVideoPlan {
  const text = normalizeText(input);
  const sentences = sentenceList(text);
  const ranked = sentences
    .map((sentence, index) => ({ sentence, index, ...headingAndScore(sentence, index) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const chosen: typeof ranked = [];
  const usedHeadings = new Set<string>();
  for (const item of ranked) {
    if (chosen.length >= 5) break;
    if (chosen.some((current) => current.sentence === item.sentence)) continue;
    if (usedHeadings.has(item.heading) && item.heading !== "Nội dung quan trọng") continue;
    chosen.push(item);
    usedHeadings.add(item.heading);
  }
  if (!chosen.length && text) {
    chosen.push({ sentence: clip(text, 500), index: 0, heading: "Nội dung chính", score: 1 });
  }
  chosen.sort((left, right) => left.index - right.index);

  const title = clip(requestedTitle?.trim() || firstTitle(text), 140);
  const scenes: LegalVideoScene[] = [
    {
      id: "mo-dau",
      heading: "Tóm tắt nhanh",
      narration: `Video này tóm lược các điểm cần chú ý trong ${title}.`,
      bullets: ["Nội dung được rút từ chính văn bản đầu vào", "Cần đối chiếu toàn văn trước khi áp dụng"],
      sourceExcerpt: clip(text, 360) || title,
      durationSeconds: 7,
    },
    ...chosen.map((item, index) => ({
      id: `y-chinh-${index + 1}`,
      heading: item.heading,
      narration: `Văn bản nêu: ${clip(item.sentence, 560)}`,
      bullets: bulletsFor(item.sentence),
      sourceExcerpt: clip(item.sentence, 480),
      durationSeconds: durationFor(item.sentence),
    })),
    {
      id: "ket-thuc",
      heading: "Trước khi áp dụng",
      narration: "Hãy kiểm tra phạm vi áp dụng, ngày hiệu lực, quy định chuyển tiếp và văn bản sửa đổi liên quan trước khi thực hiện.",
      bullets: ["Đối chiếu đúng đối tượng", "Kiểm tra hiệu lực tại thời điểm áp dụng", "Mở toàn văn để xem căn cứ và ngoại lệ"],
      sourceExcerpt: "Nội dung video chỉ là bản tóm tắt hỗ trợ tiếp cận văn bản.",
      durationSeconds: 9,
    },
  ].slice(0, 8);

  return {
    version: 1,
    title,
    subtitle: "Các ý chính cần nắm",
    summary: clip(chosen.map((item) => item.sentence).join(" "), 480) || "Chưa đủ nội dung để tạo bản tóm tắt.",
    format: "vertical",
    scenes,
    disclaimer: "Video chỉ nhằm hỗ trợ đọc nhanh; toàn văn và nguồn chính thức mới là căn cứ áp dụng.",
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

export function validateVideoPlan(value: unknown): LegalVideoPlan | null {
  if (!value || typeof value !== "object") return null;
  const plan = value as Partial<LegalVideoPlan>;
  if (plan.version !== 1 || typeof plan.title !== "string" || typeof plan.subtitle !== "string") return null;
  if (typeof plan.summary !== "string" || typeof plan.disclaimer !== "string") return null;
  if (plan.format !== "vertical" && plan.format !== "landscape") return null;
  if (!Array.isArray(plan.scenes) || plan.scenes.length < 3 || plan.scenes.length > 8) return null;
  for (const scene of plan.scenes) {
    if (!scene || typeof scene !== "object") return null;
    if (typeof scene.id !== "string" || typeof scene.heading !== "string" || typeof scene.narration !== "string") return null;
    if (!isStringArray(scene.bullets) || typeof scene.sourceExcerpt !== "string") return null;
    if (typeof scene.durationSeconds !== "number" || scene.durationSeconds < 4 || scene.durationSeconds > 35) return null;
    if (scene.mermaid != null && typeof scene.mermaid !== "string") return null;
  }
  return plan as LegalVideoPlan;
}

export function buildOllamaMessages(text: string, title?: string) {
  const source = normalizeText(text);
  return [
    {
      role: "system",
      content: [
        "Bạn là biên tập viên pháp luật thuế Việt Nam.",
        "Chỉ dùng thông tin có trong nguồn; không suy đoán, không thêm mức tiền, ngày tháng, đối tượng hoặc nghĩa vụ.",
        "Mỗi cảnh phải có sourceExcerpt là trích đoạn nguyên văn hỗ trợ trực tiếp cho cảnh đó.",
        "Ưu tiên: phạm vi áp dụng, điểm mới, nghĩa vụ, thời hạn, mức tiền hoặc tỷ lệ, hiệu lực và chuyển tiếp.",
        "Lời đọc cần rõ ràng, trung tính, phù hợp video 60-120 giây.",
        "Không coi video là tư vấn pháp lý; luôn giữ câu cảnh báo ở cuối.",
      ].join(" "),
    },
    {
      role: "user",
      content: `${title ? `Tiêu đề gợi ý: ${title}\n\n` : ""}Hãy tạo storyboard JSON theo schema đã cung cấp từ văn bản sau:\n\n${source}`,
    },
  ];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function timecode(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function renderVideoVtt(plan: LegalVideoPlan) {
  let cursor = 0;
  const cues = plan.scenes.map((scene, index) => {
    const start = cursor;
    cursor += scene.durationSeconds;
    return `${index + 1}\n${timecode(start)} --> ${timecode(cursor)}\n${scene.narration}`;
  });
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

export function renderHyperframesHtml(plan: LegalVideoPlan, audioFile = "") {
  const vertical = plan.format === "vertical";
  const width = vertical ? 1080 : 1920;
  const height = vertical ? 1920 : 1080;
  let cursor = 0;
  const scenes = plan.scenes.map((scene, index) => {
    const start = cursor;
    cursor += scene.durationSeconds;
    const bullets = scene.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("");
    return `<section class="scene scene-${index + 1}" data-start="${start}" data-duration="${scene.durationSeconds}" data-track-index="1" data-fade="in">
      <div class="scene-number">${String(index + 1).padStart(2, "0")}</div>
      <p class="eyebrow">THUẾ RÕ · TÓM TẮT VĂN BẢN</p>
      <h2>${escapeHtml(scene.heading)}</h2>
      <ul>${bullets}</ul>
      <p class="caption">${escapeHtml(scene.narration)}</p>
    </section>`;
  }).join("\n");

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(plan.title)}</title>
<style>
  :root { color-scheme: light; font-family: Arial, Helvetica, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #eaf2ee; overflow: hidden; }
  #stage { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: radial-gradient(circle at 80% 5%, #d7eee4 0, transparent 32%), linear-gradient(160deg, #f9fcfa, #e8f1ed); color: #102a21; }
  #stage::before { content: ""; position: absolute; inset: 44px; border: 2px solid rgba(16,42,33,.12); border-radius: 42px; }
  .brand { position: absolute; top: 76px; left: 82px; z-index: 5; font-size: 32px; font-weight: 900; letter-spacing: -.04em; }
  .brand span { color: #db5b35; }
  .scene { position: absolute; inset: 170px 82px 92px; display: flex; flex-direction: column; justify-content: center; padding: 72px 64px 210px; border-radius: 44px; background: rgba(255,255,255,.82); box-shadow: 0 28px 90px rgba(16,42,33,.10); }
  .scene-number { position: absolute; top: 48px; right: 56px; font-size: 28px; font-weight: 800; opacity: .38; }
  .eyebrow { margin: 0 0 28px; font-size: 22px; font-weight: 800; letter-spacing: .12em; color: #416a59; }
  h2 { margin: 0 0 42px; max-width: 860px; font-size: ${vertical ? 76 : 82}px; line-height: 1.05; letter-spacing: -.045em; }
  ul { margin: 0; padding-left: 1.1em; display: grid; gap: 24px; max-width: 900px; font-size: ${vertical ? 38 : 42}px; line-height: 1.28; }
  li::marker { color: #db5b35; }
  .caption { position: absolute; left: 48px; right: 48px; bottom: 42px; margin: 0; padding: 24px 30px; border-radius: 22px; background: rgba(16,42,33,.94); color: #fff; font-size: ${vertical ? 29 : 32}px; line-height: 1.35; text-align: center; }
  .footer { position: absolute; left: 82px; right: 82px; bottom: 42px; display: flex; justify-content: space-between; font-size: 20px; color: #416a59; }
</style>
</head>
<body>
<div id="stage" data-composition-id="legal-summary" data-width="${width}" data-height="${height}" data-duration="${cursor}" data-fps="30">
  <div class="brand" data-start="0" data-duration="${cursor}" data-track-index="4">Thuế<span>.</span></div>
  ${scenes}
  ${audioFile ? `<audio src="${escapeHtml(audioFile)}" data-start="0" data-duration="${cursor}" data-track-index="3"></audio>` : ""}
  <div class="footer" data-start="0" data-duration="${cursor}" data-track-index="4"><span>${escapeHtml(plan.title)}</span><span>${escapeHtml(plan.disclaimer)}</span></div>
</div>
</body>
</html>\n`;
}
