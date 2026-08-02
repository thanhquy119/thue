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
});

test("phụ đề được chia theo câu, mệnh đề và từ mà không chèn dấu ba chấm", () => {
  assert.match(storyboardSource, /export function captionChunksFromNarration/u);
  assert.match(storyboardSource, /splitMeaningfulPhrases\(sentence, maxChars\)/u);
  assert.match(storyboardSource, /splitWords\(piece, maxChars\)/u);
  assert.doesNotMatch(
    storyboardSource.slice(
      storyboardSource.indexOf("export function captionChunksFromNarration"),
      storyboardSource.indexOf("function normalizedTokens"),
    ),
    /`${[^}]+}…`|slice\(0,\s*maxChars\)/u,
  );
});

test("câu pháp lý dài được tách thành các cụm hình ảnh hoàn chỉnh", () => {
  assert.match(storyboardSource, /export function splitMeaningfulPhrases/u);
  assert.match(storyboardSource, /hoặc\|đồng thời\|nếu\|khi\|trường hợp\|sau khi\|trước khi/u);
  assert.match(storyboardSource, /splitWords\(clause, maxChars\)/u);
  assert.match(storyboardSource, /Không dùng dấu ba chấm và không cắt câu giữa chừng/u);
});

test("Remotion có hệ hình ảnh ngữ nghĩa thay vì một icon cạnh danh sách text", () => {
  for (const component of [
    "SceneBackdrop", "KeywordGlyph", "DocumentVisual", "TimelineVisual", "NetworkVisual",
    "FlowVisual", "ContrastVisual", "MetricVisual", "ChecklistVisual", "DecisionVisual", "TakeawayVisual",
  ]) assert.match(templateSource, new RegExp(`const ${component}`, "u"));
  assert.match(templateSource, /strokeDashoffset=\{-frame \* \.7\}/u);
  assert.match(templateSource, /pathLength="1"/u);
});

test("cảnh không bị làm trắng trước khi kết thúc và caption chuyển nhẹ theo câu", () => {
  assert.doesNotMatch(templateSource, /durationInFrames - 16/u);
  assert.doesNotMatch(templateSource, /const exit = interpolate/u);
  const source = captionSource();
  assert.match(source, /localFrame/u);
  assert.match(source, /\[0,6\],\[0,1\]/u);
  assert.match(source, /minHeight:176/u);
});

test("kết luận nêu tác động hoặc việc cần kiểm tra, không dùng câu meta vô nghĩa", () => {
  assert.doesNotMatch(templateSource, /Giữ lại những ý quan trọng nhất/u);
  assert.doesNotMatch(storyboardSource, /title: "Những điểm cần nhớ sau khi xem"/u);
  assert.match(storyboardSource, /Ba việc cần kiểm tra trước khi áp dụng/u);
  assert.match(storyboardSource, /Ba tác động trực tiếp cần ghi nhớ/u);
  assert.match(storyboardSource, /KẾT LUẬN THỰC TẾ/u);
});

test("pipeline loại bỏ title lặp bullet và từ chối nội dung bị cắt", () => {
  assert.match(storyboardSource, /removeTitleRepeats/u);
  assert.match(storyboardSource, /textSimilarity\(title, bullet\) >= 0\.72/u);
  assert.match(storyboardSource, /Không dùng dấu ba chấm, không cắt câu/u);
  assert.match(chunkingSource, /truncated_content/u);
});

test("ngày ban hành trùng ngày hiệu lực chỉ tạo một mốc", () => {
  assert.match(storyboardSource, /const sameDate = Boolean\(issued && effective && issued === effective\)/u);
  assert.match(storyboardSource, /Ban hành và có hiệu lực:/u);
});