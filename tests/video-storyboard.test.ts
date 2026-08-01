import assert from "node:assert/strict";
import test from "node:test";
import { verifyVideoPlanAgainstSource } from "../lib/video/evidence.ts";
import {
  buildFallbackVideoPlan,
  renderHyperframesHtml,
  renderVideoVtt,
  validateVideoPlan,
} from "../lib/video/storyboard.ts";

const SOURCE = `THÔNG TƯ MẪU
Điều 1. Thông tư áp dụng đối với người nộp thuế thực hiện thủ tục điện tử.
Điều 2. Người nộp thuế phải cập nhật thông tin trong vòng 10 ngày làm việc kể từ ngày thay đổi.
Điều 3. Thông tư có hiệu lực từ ngày 01 tháng 10 năm 2026 và thay thế quy định trước đây.`;

test("fallback storyboard giữ dẫn chứng và giới hạn cảnh", () => {
  const plan = buildFallbackVideoPlan(SOURCE);
  assert.ok(plan.scenes.length >= 3 && plan.scenes.length <= 8);
  assert.ok(plan.scenes.every((scene) => scene.sourceExcerpt.length > 0));
  assert.equal(validateVideoPlan(plan)?.version, 1);
  assert.equal(verifyVideoPlanAgainstSource(plan, SOURCE).ok, true);
});

test("bộ kiểm chứng từ chối trích dẫn không tồn tại", () => {
  const plan = structuredClone(buildFallbackVideoPlan(SOURCE));
  plan.scenes[0].sourceExcerpt = "Quy định này hoàn toàn không xuất hiện trong nguồn.";
  const result = verifyVideoPlanAgainstSource(plan, SOURCE);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /sourceExcerpt không tìm thấy/u);
});

test("bộ kiểm chứng từ chối số liệu do LLM tự thêm", () => {
  const plan = structuredClone(buildFallbackVideoPlan(SOURCE));
  plan.scenes[1].bullets.push("Được giảm 99% nghĩa vụ thuế.");
  const result = verifyVideoPlanAgainstSource(plan, SOURCE);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /99/u);
});

test("gói HyperFrames có timeline, caption và kích thước dọc", () => {
  const plan = buildFallbackVideoPlan(SOURCE);
  const html = renderHyperframesHtml(plan);
  assert.match(html, /data-composition-id="legal-summary"/u);
  assert.match(html, /data-width="1080"/u);
  assert.match(html, /data-height="1920"/u);
  assert.match(html, /class="caption"/u);
});

test("VTT tăng mốc thời gian theo thời lượng cảnh", () => {
  const plan = buildFallbackVideoPlan(SOURCE);
  const vtt = renderVideoVtt(plan);
  assert.match(vtt, /^WEBVTT/u);
  assert.match(vtt, /00:00:00\.000 --> 00:00:07\.000/u);
  assert.equal((vtt.match(/-->/gu) ?? []).length, plan.scenes.length);
});
