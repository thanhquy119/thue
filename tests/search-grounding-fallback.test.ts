import assert from "node:assert/strict";
import test from "node:test";
import {
  crossCheckOfficialSources,
  normalizeOfficialDocumentNumber,
  normalizeOfficialSourceUrl,
  shouldCrossCheckWithGrounding,
} from "../lib/legal/search-grounding-cross-check.ts";
import {
  extractGroundingWebChunks,
  isGroundingRedirectUrl,
  searchGroundingEnabled,
  searchGroundingMaxResults,
  searchGroundingModel,
} from "../lib/legal/search-grounding-fallback.ts";
import type { OnlineLegalSource } from "../lib/legal/types.ts";

function withEnvironment(values: Record<string, string | undefined>, run: () => void) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
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

function legalSource(
  id: string,
  number: string | undefined,
  url: string,
  overrides: Partial<OnlineLegalSource> = {},
): OnlineLegalSource {
  return {
    id,
    title: overrides.title ?? `${number ?? "Văn bản"} về quản lý thuế`,
    url,
    snippet: overrides.snippet ?? "Quy định hiện hành về nghĩa vụ thuế.",
    score: overrides.score ?? 1,
    source_label: overrides.source_label ?? "Cổng thông tin Chính phủ",
    previewable: true,
    document_number: number,
    document_type: overrides.document_type ?? "Thông tư",
    issuer: overrides.issuer ?? "Bộ Tài chính",
    issued_date: overrides.issued_date ?? "2026-06-30",
  };
}

test("keeps Search Grounding disabled unless explicitly enabled", () => {
  withEnvironment({ ENABLE_SEARCH_GROUNDING_FALLBACK: undefined }, () => {
    assert.equal(searchGroundingEnabled(), false);
  });
  withEnvironment({ ENABLE_SEARCH_GROUNDING_FALLBACK: "true" }, () => {
    assert.equal(searchGroundingEnabled(), true);
  });
});

test("uses only supported Gemini 2.5 grounding models", () => {
  withEnvironment({ SEARCH_GROUNDING_GEMINI_MODEL: "models/gemini-2.5-flash" }, () => {
    assert.equal(searchGroundingModel(), "gemini-2.5-flash");
  });
  withEnvironment({ SEARCH_GROUNDING_GEMINI_MODEL: "gemini-3.5-flash-lite" }, () => {
    assert.equal(searchGroundingModel(), "gemini-2.5-flash-lite");
  });
});

test("caps grounded result count to protect quota and runtime", () => {
  withEnvironment({ SEARCH_GROUNDING_MAX_RESULTS: undefined }, () => {
    assert.equal(searchGroundingMaxResults(), 6);
  });
  withEnvironment({ SEARCH_GROUNDING_MAX_RESULTS: "999" }, () => {
    assert.equal(searchGroundingMaxResults(), 10);
  });
  withEnvironment({ SEARCH_GROUNDING_MAX_RESULTS: "0" }, () => {
    assert.equal(searchGroundingMaxResults(), 6);
  });
});

test("extracts only web citations returned in grounding metadata", () => {
  assert.deepEqual(
    extractGroundingWebChunks({
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: " https://vertexaisearch.cloud.google.com/redirect/abc ", title: " Thông tư mới " } },
              { web: { uri: 123, title: "ignored" } },
              {},
            ],
          },
        },
      ],
    }),
    [{ uri: "https://vertexaisearch.cloud.google.com/redirect/abc", title: "Thông tư mới" }],
  );
});

test("accepts only the known Google grounding redirect host", () => {
  assert.equal(isGroundingRedirectUrl("https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc"), true);
  assert.equal(isGroundingRedirectUrl("https://example.com/redirect/abc"), false);
  assert.equal(isGroundingRedirectUrl("http://vertexaisearch.cloud.google.com/redirect/abc"), false);
});

test("normalizes exact document numbers and official URLs before matching", () => {
  assert.equal(normalizeOfficialDocumentNumber("Nghị định 141 / 2026 / ND-CP"), "141/2026/NĐ-CP");
  assert.equal(
    normalizeOfficialSourceUrl(
      "https://www.congbao.chinhphu.vn/van-ban/141/?utm_source=grounding&file=1#top",
    ),
    "https://congbao.chinhphu.vn/van-ban/141?file=1",
  );
  assert.equal(normalizeOfficialSourceUrl("http://congbao.chinhphu.vn/van-ban/141"), "");
});

test("cross-checks only high-risk questions with weak direct discovery", () => {
  withEnvironment({ ENABLE_SEARCH_GROUNDING_FALLBACK: "true" }, () => {
    assert.equal(
      shouldCrossCheckWithGrounding(
        "Hộ kinh doanh doanh thu bao nhiêu thì không phải nộp thuế hiện hành?",
        [],
        1.4,
      ),
      true,
    );

    assert.equal(
      shouldCrossCheckWithGrounding(
        "Doanh nghiệp khai thuế GTGT dùng mẫu nào?",
        [],
        1.4,
      ),
      false,
    );
  });
});

test("does not spend grounding quota when two strong numbered sources already exist", () => {
  const direct = [
    legalSource("a", "10/2026/TT-BTC", "https://congbao.chinhphu.vn/van-ban/a", {
      title: "Thông tư quy định thuế suất thuế giá trị gia tăng đối với doanh nghiệp",
      snippet: "Thuế suất, mức thuế và căn cứ tính thuế GTGT hiện hành.",
    }),
    legalSource("b", "11/2026/TT-BTC", "https://mof.gov.vn/van-ban/b", {
      title: "Thông tư hướng dẫn thuế suất thuế giá trị gia tăng",
      snippet: "Mức thuế và cách tính thuế GTGT đối với doanh nghiệp.",
    }),
  ];

  withEnvironment({ ENABLE_SEARCH_GROUNDING_FALLBACK: "true" }, () => {
    assert.equal(
      shouldCrossCheckWithGrounding(
        "Thuế suất GTGT hiện hành của doanh nghiệp là bao nhiêu phần trăm?",
        direct,
        1.4,
      ),
      false,
    );
  });
});

test("exact normalized document-number match only boosts ranking and deduplicates", () => {
  const direct = legalSource(
    "direct",
    "141/2026/NĐ-CP",
    "https://congbao.chinhphu.vn/van-ban/nghi-dinh-141",
    { score: 3 },
  );
  const grounded = legalSource(
    "grounded",
    "141 / 2026 / ND-CP",
    "https://mof.gov.vn/Pages/van-ban-khac.aspx?id=141",
    { source_label: "Google Search Grounding → nguồn chính thức" },
  );

  const result = crossCheckOfficialSources([direct], [grounded]);
  assert.equal(result.sources.length, 1);
  assert.equal(result.matchCount, 1);
  assert.equal(result.newSourceCount, 0);
  assert.ok(result.sources[0].score > direct.score);
  assert.match(result.sources[0].source_label, /đối chiếu Search Grounding/iu);
});

test("normalized URL match ignores tracking parameters and trailing slash", () => {
  const direct = legalSource(
    "direct-url",
    undefined,
    "https://www.mof.gov.vn/van-ban/huong-dan/?file=1&utm_source=direct",
    { score: 2 },
  );
  const grounded = legalSource(
    "grounded-url",
    undefined,
    "https://mof.gov.vn/van-ban/huong-dan?utm_medium=search&file=1#section",
    { source_label: "Google Search Grounding → nguồn chính thức" },
  );

  const result = crossCheckOfficialSources([direct], [grounded]);
  assert.equal(result.sources.length, 1);
  assert.equal(result.matchCount, 1);
  assert.equal(result.newSourceCount, 0);
  assert.ok(result.sources[0].score > direct.score);
});

test("keeps a new grounded official source as an unverified candidate", () => {
  const direct = legalSource(
    "direct-old",
    "68/2026/NĐ-CP",
    "https://congbao.chinhphu.vn/van-ban/nghi-dinh-68",
  );
  const grounded = legalSource(
    "grounded-new",
    "141/2026/NĐ-CP",
    "https://congbao.chinhphu.vn/van-ban/nghi-dinh-141",
    { source_label: "Google Search Grounding → nguồn chính thức" },
  );

  const result = crossCheckOfficialSources([direct], [grounded]);
  assert.equal(result.sources.length, 2);
  assert.equal(result.matchCount, 0);
  assert.equal(result.newSourceCount, 1);
  assert.equal(result.warnings.length, 0);
  assert.match(result.sources[1].snippet, /Quy định hiện hành/iu);
});

test("flags conflicting document numbers on the same official URL without boosting", () => {
  const direct = legalSource(
    "direct-conflict",
    "90/2026/TT-BTC",
    "https://congbao.chinhphu.vn/van-ban/thong-tu-dang-ky-thue",
    { score: 4 },
  );
  const grounded = legalSource(
    "grounded-conflict",
    "91/2026/TT-BTC",
    "https://www.congbao.chinhphu.vn/van-ban/thong-tu-dang-ky-thue/?utm_source=google",
    { source_label: "Google Search Grounding → nguồn chính thức" },
  );

  const result = crossCheckOfficialSources([direct], [grounded]);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].score, direct.score);
  assert.equal(result.matchCount, 0);
  assert.equal(result.newSourceCount, 0);
  assert.equal(result.conflicts.length, 1);
  assert.match(result.warnings[0], /xác minh toàn văn/iu);
});
