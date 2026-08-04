// E2E marker: render Thông tư 94 sau khi khóa card network và dấu tiếng Việt.
import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeVisualTexts,
  hasReliableVietnameseDiacritics,
  normalizeSceneForVideo,
  visualTextSimilarity,
} from "../lib/video/storyboard-normalize.ts";
import type {LegalVideoScene} from "../lib/video/types.ts";

function scopeScene(overrides: Partial<LegalVideoScene> = {}): LegalVideoScene {
  return {
    id: "scene-scope",
    kind: "audience",
    category: "scope",
    eyebrow: "AI CHỊU TÁC ĐỘNG",
    title: "Ai thuộc phạm vi áp dụng?",
    subtitle: "",
    bullets: [
      "Đối tượng áp dụng gồm người nộp thuế, cơ quan thuế và các bên có liên quan.",
      "Người nộp thuế tự nguyện đăng ký tuân thủ pháp luật thuế cần sẵn sàng kết nối và chia sẻ dữ liệu điện tử liên quan với cơ quan thuế.",
    ],
    narration: "Đối tượng áp dụng gồm người nộp thuế, cơ quan thuế và các bên có liên quan. Người nộp thuế tự nguyện đăng ký tuân thủ pháp luật thuế cần sẵn sàng kết nối và chia sẻ dữ liệu điện tử liên quan với cơ quan thuế.",
    captionChunks: [],
    evidencePointIds: [],
    sourceExcerpt: "Đối tượng áp dụng gồm người nộp thuế, cơ quan thuế và các bên có liên quan.",
    visualMode: "network",
    visualKeywords: [
      "Đối tượng áp dụng gồm người nộp thuế, cơ quan thuế và các bên có liên quan",
      "Người nộp thuế tự nguyện đăng ký tuân thủ pháp luật thuế cần sẵn sàng kết nối và chia sẻ dữ liệu điện tử liên quan với cơ quan thuế",
      "Người nộp thuế tự nguyện đăng ký tuân thủ pháp luật thuế cần sẵn sàng kết nối và chia sẻ dữ liệu điện tử liên quan với cơ quan thuế.",
    ],
    audioChunks: [],
    ...overrides,
  };
}

test("visual text coi khác biệt dấu chấm cuối là cùng một nội dung", () => {
  const plain = "Người nộp thuế cần kết nối và chia sẻ dữ liệu điện tử với cơ quan thuế";
  assert.equal(visualTextSimilarity(plain, `${plain}.`), 1);
  assert.deepEqual(dedupeVisualTexts([plain, `${plain}.`], 3), [plain]);
});

test("cảnh network chỉ giữ hai card vệ tinh và không tạo card thứ ba ở trung tâm", () => {
  const scene = normalizeSceneForVideo(scopeScene());
  assert.equal(scene.visualKeywords?.length, 2);
  assert.match(scene.visualKeywords?.[0] ?? "", /Đối tượng áp dụng/u);
  assert.match(scene.visualKeywords?.[1] ?? "", /tự nguyện đăng ký/u);
});

test("từ chối chuỗi dài bị mất phần lớn dấu tiếng Việt", () => {
  assert.equal(
    hasReliableVietnameseDiacritics("Nguoi nop thue tu nguyen dang ky tuan thu phap luat thue can san sang ket noi va chia se du lieu dien tu"),
    false,
  );
  assert.equal(
    hasReliableVietnameseDiacritics("Người nộp thuế tự nguyện đăng ký tuân thủ pháp luật thuế cần sẵn sàng kết nối và chia sẻ dữ liệu điện tử"),
    true,
  );
});

test("visual keyword mất dấu được thay bằng bullet tiếng Việt có dấu", () => {
  const scene = normalizeSceneForVideo(scopeScene({
    visualKeywords: [
      "Nguoi nop thue tu nguyen dang ky tuan thu phap luat thue can san sang ket noi va chia se du lieu dien tu",
    ],
  }));
  assert.ok(scene.visualKeywords?.length);
  assert.ok(scene.visualKeywords?.every(hasReliableVietnameseDiacritics));
  assert.doesNotMatch(scene.visualKeywords?.join(" ") ?? "", /Nguoi nop thue/u);
});
