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

function timelineSource() {
  const start = templateSource.indexOf("const TimelineVisual");
  const end = templateSource.indexOf("const ProcessVisual", start);
  assert.ok(start >= 0 && end > start, "Không tìm thấy TimelineVisual trong template Remotion");
  return templateSource.slice(start, end);
}

test("không còn dòng chú thích dư dưới trình phát video", () => {
  assert.doesNotMatch(
    panelSource,
    /Video giúp nắm nhanh nội dung; toàn văn chính thức vẫn nằm ngay bên dưới để đối chiếu\./u,
  );
});

test("template v3 buộc video mới dùng thiết kế pastel và pipeline biên tập mới", () => {
  assert.match(chunkingSource, /VIDEO_TEMPLATE_VERSION = "legal-video-v3"/u);
  assert.match(chunkingSource, /VIDEO_PIPELINE_VERSION = "legal-video-pipeline-v3"/u);
  assert.match(templateSource, /backgroundColor: COLORS\.pale/u);
});

test("khung phụ đề cố định, bỏ nhãn thuyết minh và không animate khi đổi câu", () => {
  const source = captionSource();
  assert.match(source, /height: 196/u);
  assert.match(source, /overflow: 'hidden'/u);
  assert.doesNotMatch(source, /LỜI THUYẾT MINH/u);
  assert.doesNotMatch(source, /opacity:\s*interpolate/u);
  assert.doesNotMatch(source, /translate|translateY|scale\(/u);
});

test("text ngắn căn trái và chỉ đoạn đủ dài mới căn đều", () => {
  const source = captionSource();
  assert.match(templateSource, /text\.length >= justifyFrom \? \('justify' as const\) : \('left' as const\)/u);
  assert.match(templateSource, /textAlignLast: 'left'/u);
  assert.match(source, /readableAlign\(caption\.text, 150\)/u);
  assert.match(timelineSource(), /readableAlign\(item, 180\)/u);
  assert.doesNotMatch(timelineSource(), /textAlignLast: 'center'/u);
});

test("video không còn chữ thương hiệu và dùng màu phẳng thay cho nền chuyển màu", () => {
  assert.doesNotMatch(templateSource, /Thuế Rõ|Thuế\.<\/|linear-gradient\(145deg|linear-gradient\(155deg|radial-gradient/u);
  assert.match(templateSource, /backgroundColor: COLORS\.mint/u);
  assert.match(templateSource, /backgroundColor: COLORS\.cream/u);
  assert.match(templateSource, /backgroundColor: COLORS\.sky/u);
});

test("mỗi loại cảnh có minh họa trực quan riêng", () => {
  for (const component of [
    "DocumentIcon",
    "CalendarIcon",
    "PeopleIcon",
    "ArrowsIcon",
    "StepsIcon",
    "PercentIcon",
    "ClipboardIcon",
    "LightbulbIcon",
  ]) {
    assert.match(templateSource, new RegExp(`const ${component}`, "u"));
  }
  assert.match(templateSource, /scene\.kind === 'audience'/u);
  assert.match(templateSource, /scene\.kind === 'change'/u);
  assert.match(templateSource, /scene\.kind === 'prepare'/u);
});

test("pipeline biên tập cảnh theo một ý chính và kiểm tra số liệu với evidence", () => {
  assert.match(storyboardSource, /Mỗi cảnh chỉ có một ý chính/u);
  assert.match(storyboardSource, /ai hoặc vấn đề gì – điều kiện – phải làm gì – hệ quả hoặc lưu ý/u);
  assert.match(storyboardSource, /groundedText\(value, points\)/u);
  assert.match(storyboardSource, /captionChunksFromNarration/u);
});

test("ngày ban hành trùng ngày hiệu lực chỉ tạo một mốc", () => {
  assert.match(storyboardSource, /const sameDate = Boolean\(issued && effective && issued === effective\)/u);
  assert.match(storyboardSource, /Ban hành và có hiệu lực:/u);
});
