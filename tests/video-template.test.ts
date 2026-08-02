import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const panelSource = readFileSync(new URL("../app/document-video-panel.tsx", import.meta.url), "utf8");
const templateSource = readFileSync(new URL("../experiments/remotion-tt89/src/LegalVideo.tsx", import.meta.url), "utf8");
const chunkingSource = readFileSync(new URL("../lib/video/chunking.ts", import.meta.url), "utf8");
const storyboardSource = readFileSync(new URL("../lib/video/storyboard.ts", import.meta.url), "utf8");

function captionSource() {
  const start = templateSource.indexOf("const CaptionBar");
  const end = templateSource.indexOf("const SceneAudio", start);
  assert.ok(start >= 0 && end > start, "Không tìm thấy CaptionBar trong template Remotion");
  return templateSource.slice(start, end);
}

test("không còn dòng chú thích dư dưới trình phát video", () => {
  assert.doesNotMatch(panelSource, /Video giúp nắm nhanh nội dung; toàn văn chính thức vẫn nằm ngay bên dưới để đối chiếu\./u);
});

test("template và pipeline v4 buộc tạo lại video theo hướng visual-first", () => {
  assert.match(chunkingSource, /VIDEO_TEMPLATE_VERSION = "legal-video-v4"/u);
  assert.match(chunkingSource, /VIDEO_PIPELINE_VERSION = "legal-video-pipeline-v4"/u);
  assert.match(templateSource, /VIDEO GIẢI THÍCH/u);
  assert.match(storyboardSource, /visualMode: "takeaways"/u);
  assert.match(storyboardSource, /visualKeywords:/u);
});

test("phụ đề được chia theo câu, mệnh đề và từ mà không chèn dấu ba chấm", () => {
  const start = storyboardSource.indexOf("export function captionChunksFromNarration");
  const end = storyboardSource.indexOf("function normalizedTokens", start);
  assert.ok(start >= 0 && end > start, "Không tìm thấy thuật toán chia phụ đề");
  const source = storyboardSource.slice(start, end);
  assert.match(source, /splitMeaningfulPhrases\(sentence, maxChars\)/u);
  assert.match(source, /splitWords\(piece, maxChars, true\)/u);
  assert.doesNotMatch(source, /…/u);
  assert.doesNotMatch(source, /slice\(0,\s*maxChars\)/u);
});

test("câu pháp lý chỉ tách ở ranh giới ý mạnh, không chặt tại mọi dấu phẩy", () => {
  const start = storyboardSource.indexOf("export function splitMeaningfulPhrases");
  const end = storyboardSource.indexOf("function displayPhrasesFromPoint", start);
  assert.ok(start >= 0 && end > start, "Không tìm thấy thuật toán tách cụm ý");
  const source = storyboardSource.slice(start, end);
  assert.match(source, /\?<=\[;:\.!\?\]/u);
  assert.match(source, /hoặc\|đồng thời\|nếu\|khi\|trường hợp\|sau khi\|trước khi/u);
  assert.doesNotMatch(source, /\?<=\[,;:\]/u);
});

test("phần đuôi phụ đề ngắn được cân bằng lại thay vì còn mảnh như rủi hoặc ro", () => {
  assert.match(storyboardSource, /function rebalanceWordChunks/u);
  assert.match(storyboardSource, /minimumTail = 34/u);
  assert.match(storyboardSource, /candidateTail/u);
  assert.match(storyboardSource, /maxChars \+ tolerance/u);
});

test("Remotion có hệ hình ảnh ngữ nghĩa thay vì một icon cạnh danh sách text", () => {
  assert.ok(templateSource.includes("function KeywordGlyph"), "Thiếu KeywordGlyph");
  for (const component of [
    "SceneBackdrop", "DocumentVisual", "TimelineVisual", "NetworkVisual", "FlowVisual",
    "ContrastVisual", "MetricVisual", "ChecklistVisual", "DecisionVisual", "TakeawayVisual",
  ]) assert.ok(templateSource.includes(`const ${component}`), `Thiếu ${component}`);
  assert.ok(templateSource.includes("strokeDashoffset={-frame * .7}"));
  assert.ok(templateSource.includes('pathLength="1"'));
});

test("cảnh không bị làm trắng trước khi kết thúc và caption chuyển nhẹ theo câu", () => {
  assert.doesNotMatch(templateSource, /durationInFrames - 16/u);
  assert.doesNotMatch(templateSource, /const exit = interpolate/u);
  const source = captionSource();
  assert.match(source, /localFrame/u);
  assert.ok(source.includes("interpolate(localFrame,[0,6],[0,1],clamp)"));
  assert.ok(source.includes("minHeight:176"));
});

test("kết luận nêu tác động hoặc việc cần kiểm tra, không dùng câu meta vô nghĩa", () => {
  assert.doesNotMatch(templateSource, /Giữ lại những ý quan trọng nhất/u);
  assert.doesNotMatch(storyboardSource, /title: "Những điểm cần nhớ sau khi xem"/u);
  assert.match(storyboardSource, /Ba việc cần kiểm tra trước khi áp dụng/u);
  assert.match(storyboardSource, /Ba tác động trực tiếp cần ghi nhớ/u);
  assert.match(storyboardSource, /KẾT LUẬN THỰC TẾ/u);
});

test("pipeline từ chối tiếng Việt không dấu và bullet kết thúc dang dở", () => {
  assert.match(storyboardSource, /function validVietnameseText/u);
  assert.match(storyboardSource, /hasVietnameseMarks/u);
  assert.match(storyboardSource, /Toàn bộ title, bullet và narration phải viết bằng tiếng Việt có dấu/u);
  assert.match(storyboardSource, /completeDisplayPhrase/u);
  assert.match(storyboardSource, /không kết thúc bullet bằng dấu phẩy/iu);
  assert.match(storyboardSource, /quản\)\$\/iu/u);
});

test("pipeline loại bỏ title lặp bullet và từ chối nội dung bị cắt", () => {
  assert.match(storyboardSource, /removeTitleRepeats/u);
  assert.match(storyboardSource, /textSimilarity\(title, bullet\) >= 0\.72/u);
  assert.match(storyboardSource, /Không dùng dấu ba chấm, không cắt câu/u);
  assert.match(chunkingSource, /truncated_content/u);
});

test("mốc hiệu lực chỉ xuất hiện ở timeline nhưng vẫn giữ tác động thay thế văn bản", () => {
  assert.match(storyboardSource, /function removeRepeatedEffectiveFacts/u);
  assert.match(storyboardSource, /function isEffectiveOnly/u);
  assert.match(storyboardSource, /thay thế\|sửa đổi\|bổ sung\|bãi bỏ\|hết hiệu lực/u);
  assert.match(storyboardSource, /Văn bản thay thế/u);
  assert.match(storyboardSource, /bodyScenes = removeRepeatedEffectiveFacts/u);
});

test("ngày ban hành trùng ngày hiệu lực chỉ tạo một mốc", () => {
  assert.match(storyboardSource, /const sameDate = Boolean\(issued && effective && issued === effective\)/u);
  assert.match(storyboardSource, /Ban hành và có hiệu lực:/u);
});