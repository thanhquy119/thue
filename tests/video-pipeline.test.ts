import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVideoEvidenceSections,
  detectVideoCoverage,
  sceneNumbersAreGrounded,
  sourceContainsEvidence,
  splitVietnameseTtsText,
  validateGroundedScene,
  videoEvidenceSectionChars,
} from "../lib/video/chunking.ts";
import {repairVideoEvidenceCoverage} from "../lib/video/coverage-repair.ts";
import {wavDurationSeconds} from "../lib/video/azure-tts.ts";
import type {DocumentDetail} from "../lib/legal/types.ts";
import type {LegalVideoEvidencePoint, LegalVideoScene} from "../lib/video/types.ts";

function wav(seconds: number, sampleRate = 24_000) {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const dataSize = Math.round(seconds * byteRate);
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, channels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, "data");
  view.setUint32(40, dataSize, true);
  return bytes;
}

const document: DocumentDetail = {
  id: "nd-178",
  number: "178/2025/NĐ-CP",
  title: "Quy định thử nghiệm về quản lý thuế",
  type: "Nghị định",
  issuer: "Chính phủ",
  issued_date: "2025-06-30",
  effective_date: "2025-07-01",
  status: "effective",
  source_url: "https://example.com",
  source_label: "Nguồn thử",
  last_verified_at: "2026-08-01T00:00:00.000Z",
  extraction_method: "html",
  quality_score: 1,
  verification_notes: null,
  official_text: "Điều 1. Phạm vi áp dụng. Nghị định áp dụng đối với người nộp thuế. Điều 2. Hồ sơ được gửi trong thời hạn 10 ngày làm việc. Mức xử lý là 5% số tiền chậm nộp. Điều 3. Nghị định có hiệu lực từ ngày 01 tháng 7 năm 2025.",
  provisions: [
    {id: "p1", type: "article", identifier: "Điều 1", article: "1", heading: "Phạm vi áp dụng", official_text: "Nghị định áp dụng đối với người nộp thuế.", order_index: 0},
    {id: "p2", type: "article", identifier: "Điều 2", article: "2", heading: "Hồ sơ", official_text: "Hồ sơ được gửi trong thời hạn 10 ngày làm việc. Mức xử lý là 5% số tiền chậm nộp.", order_index: 1},
    {id: "p3", type: "article", identifier: "Điều 3", article: "3", heading: "Hiệu lực", official_text: "Nghị định có hiệu lực từ ngày 01 tháng 7 năm 2025.", order_index: 2},
  ],
};

test("chia giọng đọc theo ranh giới câu và không vượt giới hạn", () => {
  const text = Array.from({length: 18}, (_, index) => `Đây là câu số ${index + 1} mô tả một nội dung pháp luật cần được đọc rõ ràng.`).join(" ");
  const chunks = splitVietnameseTtsText(text, 220, 320);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 320));
  assert.equal(chunks.join(" ").replace(/\s+/gu, " "), text.replace(/\s+/gu, " "));
});

test("đọc đúng thời lượng WAV PCM", () => {
  assert.equal(wavDurationSeconds(wav(2.5)), 2.5);
});

test("từ chối WAV có phần fmt bị cắt", () => {
  assert.throws(() => wavDurationSeconds(wav(1).slice(0, 27)));
});

test("chỉ chấp nhận trích đoạn có trong nguồn", () => {
  assert.equal(sourceContainsEvidence(document.official_text, "Hồ sơ được gửi trong thời hạn 10 ngày làm việc."), true);
  assert.equal(sourceContainsEvidence(document.official_text, "Hồ sơ được gửi trong thời hạn 30 ngày làm việc."), false);
});

test("phát hiện số liệu do storyboard tự thêm", () => {
  const scene: LegalVideoScene = {
    id: "scene-1",
    kind: "numbers",
    category: "numbers",
    eyebrow: "MỨC XỬ LÝ",
    title: "Mức xử lý là 99%",
    subtitle: "",
    bullets: ["Thời hạn 10 ngày làm việc"],
    narration: "Mức xử lý là 99%.",
    captionChunks: ["Mức xử lý là 99%"],
    evidencePointIds: ["p1"],
    sourceExcerpt: "Mức xử lý là 5% số tiền chậm nộp.",
  };
  assert.equal(sceneNumbersAreGrounded(scene, document.official_text), false);
  assert.ok(validateGroundedScene(scene, document.official_text).includes("ungrounded_number"));
});

test("nhận diện các nhóm ý chính hiện diện trong văn bản", () => {
  const coverage = detectVideoCoverage(document);
  assert.ok(coverage.includes("scope"));
  assert.ok(coverage.includes("deadline"));
  assert.ok(coverage.includes("numbers"));
  assert.ok(coverage.includes("effective"));
});

test("tự bù nhóm ý chính mà lượt tóm tắt ban đầu bỏ sót", () => {
  const initial: LegalVideoEvidencePoint[] = [{
    id: "overview-1",
    category: "overview",
    importance: 4,
    claim: "Văn bản quy định về quản lý thuế.",
    sourceExcerpt: "Quy định thử nghiệm về quản lý thuế",
    sectionId: "section-1",
    provisionIds: [],
  }];
  const repaired = repairVideoEvidenceCoverage(document, initial);
  const categories = new Set(repaired.map((point) => point.category));
  assert.ok(categories.has("scope"));
  assert.ok(categories.has("deadline"));
  assert.ok(categories.has("numbers"));
  assert.ok(categories.has("effective"));
  assert.ok(repaired.every((point) => point.sourceExcerpt.length > 0));
});

test("chia toàn văn theo provision mà không làm mất thứ tự", () => {
  const sections = buildVideoEvidenceSections(document, 90);
  assert.ok(sections.length >= 2);
  assert.equal(sections[0].provisionIds[0], "p1");
  assert.equal(sections.at(-1)?.provisionIds.at(-1), "p3");
});

test("video ngắn dùng phần nguồn lớn hơn để giảm số lượt gọi mô hình", () => {
  const longDocument: DocumentDetail = {
    ...document,
    official_text: Array.from({length: 60}, (_, index) => `Điều ${index + 1}. ${"Nội dung quản lý thuế và nghĩa vụ thực hiện. ".repeat(80)}`).join("\n"),
    provisions: Array.from({length: 60}, (_, index) => ({
      id: `long-${index + 1}`,
      type: "article",
      identifier: `Điều ${index + 1}`,
      article: String(index + 1),
      heading: `Nội dung ${index + 1}`,
      official_text: "Nội dung quản lý thuế và nghĩa vụ thực hiện. ".repeat(80),
      order_index: index,
    })),
  };
  const briefChars = videoEvidenceSectionChars(longDocument, "brief");
  const standardChars = videoEvidenceSectionChars(longDocument, "standard");
  const detailedChars = videoEvidenceSectionChars(longDocument, "detailed");
  assert.ok(briefChars >= standardChars);
  assert.ok(standardChars >= detailedChars);
  assert.ok(
    buildVideoEvidenceSections(longDocument, briefChars).length
      <= buildVideoEvidenceSections(longDocument, detailedChars).length,
  );
});
