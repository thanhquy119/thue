import assert from "node:assert/strict";
import test from "node:test";
import {captionChunksBySentence} from "../lib/video/caption-sentences.ts";

test("không kéo phần đầu câu sau vào caption trước", () => {
  const chunks = captionChunksBySentence(
    "Hệ thống áp dụng tiêu chí phân loại mức độ rủi ro tương ứng. Người nộp thuế rủi ro cao được theo dõi thường xuyên.",
    80,
  );

  assert.deepEqual(chunks, [
    "Hệ thống áp dụng tiêu chí phân loại mức độ rủi ro tương ứng.",
    "Người nộp thuế rủi ro cao được theo dõi thường xuyên.",
  ]);
  assert.ok(chunks.every((chunk) => !/[.!?]\s+\S/u.test(chunk)));
});

test("cân bằng câu dài nhưng không tạo mảnh một hoặc hai từ", () => {
  const chunks = captionChunksBySentence(
    "Người nộp thuế rủi ro cao thay đổi cơ quan thuế quản lý phải chịu kiểm tra tại trụ sở để xác định đầy đủ nghĩa vụ còn phải thực hiện.",
    72,
  );

  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.split(/\s+/gu).length >= 3));
  assert.equal(chunks.join(" "), "Người nộp thuế rủi ro cao thay đổi cơ quan thuế quản lý phải chịu kiểm tra tại trụ sở để xác định đầy đủ nghĩa vụ còn phải thực hiện.");
});

test("giữ dấu câu cuối và chuẩn hóa khoảng trắng", () => {
  assert.deepEqual(
    captionChunksBySentence("  Cơ quan thuế kiểm tra tại trụ sở .   Hồ sơ được xử lý tiếp!  ", 100),
    ["Cơ quan thuế kiểm tra tại trụ sở.", "Hồ sơ được xử lý tiếp!"],
  );
});
