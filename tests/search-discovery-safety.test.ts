import assert from "node:assert/strict";
import test from "node:test";
import {
  applySearchDiscoveryConfidence,
  searchDiscoverySafety,
} from "../lib/legal/search-discovery-safety.ts";

test("preserves ordinary discovery warnings without capping confidence", () => {
  const safety = searchDiscoverySafety(["Một nguồn phản hồi chậm."], [], false);
  assert.deepEqual(safety.warnings, ["Một nguồn phản hồi chậm."]);
  assert.equal(safety.hasConflict, false);
  assert.equal(applySearchDiscoveryConfidence(0.86, safety), 0.86);
});

test("unresolved Grounding metadata conflicts block high-confidence conclusions", () => {
  const safety = searchDiscoverySafety(
    ["Nguồn trực tiếp và Search Grounding có metadata mâu thuẫn. Hệ thống chỉ được kết luận sau khi tải và xác minh toàn văn từ URL chính thức."],
    ["Cùng URL chính thức nhưng metadata ghi hai số hiệu khác nhau."],
    false,
  );
  assert.equal(safety.hasConflict, true);
  assert.equal(safety.confidenceCap, 0.38);
  assert.equal(applySearchDiscoveryConfidence(0.92, safety), 0.38);
  assert.match(safety.warnings.join(" "), /không đưa ra kết luận pháp lý/iu);
});

test("full-text verification resolves metadata conflicts without trusting Grounding metadata", () => {
  const safety = searchDiscoverySafety(
    ["Nguồn trực tiếp và Search Grounding có metadata mâu thuẫn. Hệ thống chỉ được kết luận sau khi tải và xác minh toàn văn từ URL chính thức."],
    ["Cùng URL chính thức nhưng metadata ghi hai số hiệu khác nhau."],
    true,
  );
  assert.equal(safety.hasConflict, true);
  assert.equal(safety.confidenceCap, null);
  assert.equal(applySearchDiscoveryConfidence(0.86, safety), 0.86);
  assert.match(safety.warnings.join(" "), /bỏ metadata đó/iu);
  assert.match(safety.warnings.join(" "), /toàn văn/iu);
});
