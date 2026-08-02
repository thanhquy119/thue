import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const panelSource = readFileSync(new URL("../app/document-video-panel.tsx", import.meta.url), "utf8");
const templateSource = readFileSync(new URL("../experiments/remotion-tt89/src/LegalVideo.tsx", import.meta.url), "utf8");
const chunkingSource = readFileSync(new URL("../lib/video/chunking.ts", import.meta.url), "utf8");

function captionSource() {
  const start = templateSource.indexOf("const CaptionBar");
  const end = templateSource.indexOf("const SceneAudio", start);
  assert.ok(start >= 0 && end > start, "Không tìm thấy CaptionBar trong template Remotion");
  return templateSource.slice(start, end);
}

test("không còn dòng chú thích dư dưới trình phát video", () => {
  assert.doesNotMatch(
    panelSource,
    /Video giúp nắm nhanh nội dung; toàn văn chính thức vẫn nằm ngay bên dưới để đối chiếu\./u,
  );
});

test("template v2 buộc video mới dùng giao diện đã cải tiến", () => {
  assert.match(chunkingSource, /VIDEO_TEMPLATE_VERSION = "legal-video-v2"/u);
});

test("khung phụ đề có chiều cao cố định và không animate theo từng caption", () => {
  const source = captionSource();
  assert.match(source, /height: 222/u);
  assert.match(source, /overflow: 'hidden'/u);
  assert.doesNotMatch(source, /opacity:\s*interpolate/u);
  assert.doesNotMatch(source, /translate|translateY|scale\(/u);
});

test("phụ đề và nội dung dài được căn đều hai bên", () => {
  const source = captionSource();
  assert.match(source, /textAlign: caption\.text\.length >= 72 \? 'justify' : 'center'/u);
  assert.match(source, /textAlignLast: 'center'/u);
  assert.match(templateSource, /const justified = \{/u);
  assert.match(templateSource, /textAlign: 'justify'/u);
});
