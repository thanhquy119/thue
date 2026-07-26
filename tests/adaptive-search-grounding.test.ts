import assert from "node:assert/strict";
import test from "node:test";
import {
  isDeepEvidenceTaxQuestion,
  isHighRiskTaxQuestion,
  shouldCrossCheckWithGrounding,
} from "../lib/legal/search-grounding-cross-check.ts";
import {
  searchGroundingEnabled,
  searchGroundingMode,
} from "../lib/legal/search-grounding-fallback.ts";
import type { OnlineLegalSource } from "../lib/legal/types.ts";

function withEnvironment(values: Record<string, string | undefined>, run: () => void) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function source(
  id: string,
  number: string,
  overrides: Partial<OnlineLegalSource> = {},
): OnlineLegalSource {
  return {
    id,
    title: overrides.title ?? `${number} quy định về quản lý thuế và kê khai thuế`,
    url: `https://congbao.chinhphu.vn/van-ban/${id}`,
    snippet: overrides.snippet ?? "Quy định hiện hành về kê khai, khấu trừ, thời hạn và nghĩa vụ thuế.",
    score: overrides.score ?? 3,
    source_label: "Công báo điện tử Chính phủ",
    previewable: true,
    document_number: number,
    document_type: "Thông tư",
    issuer: "Bộ Tài chính",
    issued_date: "2026-06-30",
  };
}

test("supports off, auto and always Search Grounding modes", () => {
  withEnvironment({ SEARCH_GROUNDING_MODE: "off", ENABLE_SEARCH_GROUNDING_FALLBACK: "true" }, () => {
    assert.equal(searchGroundingMode(), "off");
    assert.equal(searchGroundingEnabled(), false);
  });
  withEnvironment({ SEARCH_GROUNDING_MODE: "auto", ENABLE_SEARCH_GROUNDING_FALLBACK: "false" }, () => {
    assert.equal(searchGroundingMode(), "auto");
    assert.equal(searchGroundingEnabled(), true);
  });
  withEnvironment({ SEARCH_GROUNDING_MODE: "always" }, () => {
    assert.equal(searchGroundingMode(), "always");
    assert.equal(searchGroundingEnabled(), true);
  });
});

test("recognizes deep evidence questions even when they cite a document", () => {
  const query = "Hướng dẫn chi tiết chỉ tiêu 37, 38 tại phụ lục Mẫu số 01/GTGT theo Thông tư 89/2026/TT-BTC";
  assert.equal(isDeepEvidenceTaxQuestion(query), true);
  withEnvironment({ SEARCH_GROUNDING_MODE: "auto" }, () => {
    assert.equal(shouldCrossCheckWithGrounding(query, [source("tt89", "89/2026/TT-BTC")], 0.6), true);
  });
});

test("recognizes high-risk deadline questions with document references", () => {
  const query = "Theo Thông tư 90/2026/TT-BTC, thời hạn nộp hồ sơ đăng ký thuế là bao nhiêu ngày?";
  assert.equal(isHighRiskTaxQuestion(query), true);
  withEnvironment({ SEARCH_GROUNDING_MODE: "auto" }, () => {
    assert.equal(shouldCrossCheckWithGrounding(query, [source("tt90", "90/2026/TT-BTC")], 0.6), true);
  });
});

test("does not spend quota on ordinary questions that are not high-risk or deep", () => {
  withEnvironment({ SEARCH_GROUNDING_MODE: "auto" }, () => {
    assert.equal(
      shouldCrossCheckWithGrounding("Doanh nghiệp khai thuế GTGT dùng mẫu nào?", [], 1.4),
      false,
    );
  });
});

test("two strong numbered sources suppress adaptive Grounding", () => {
  const query = "Thuế suất GTGT hiện hành của doanh nghiệp là bao nhiêu phần trăm?";
  const direct = [
    source("a", "10/2026/TT-BTC", {
      score: 5,
      title: "Thông tư quy định thuế suất thuế giá trị gia tăng đối với doanh nghiệp",
      snippet: "Thuế suất, mức thuế và căn cứ tính thuế GTGT hiện hành.",
    }),
    source("b", "11/2026/TT-BTC", {
      score: 5,
      title: "Thông tư hướng dẫn thuế suất thuế giá trị gia tăng",
      snippet: "Mức thuế và cách tính thuế GTGT đối với doanh nghiệp.",
    }),
  ];
  withEnvironment({ SEARCH_GROUNDING_MODE: "auto" }, () => {
    assert.equal(shouldCrossCheckWithGrounding(query, direct, 1.4), false);
  });
});

test("always mode is reserved for diagnostics and cross-checks every question", () => {
  withEnvironment({ SEARCH_GROUNDING_MODE: "always" }, () => {
    assert.equal(
      shouldCrossCheckWithGrounding("Doanh nghiệp khai thuế GTGT dùng mẫu nào?", [source("a", "10/2026/TT-BTC")]),
      true,
    );
  });
});
