import assert from "node:assert/strict";
import test from "node:test";
import {
  extractGroundingWebChunks,
  isGroundingRedirectUrl,
  searchGroundingEnabled,
  searchGroundingMaxResults,
  searchGroundingModel,
} from "../lib/legal/search-grounding-fallback.ts";

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
