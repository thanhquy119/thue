import assert from "node:assert/strict";
import test from "node:test";
import {
  searchGroundingModel,
  searchGroundingModelCandidates,
} from "../lib/legal/search-grounding-fallback.ts";

function withModel(value: string | undefined, run: () => void) {
  const previous = process.env.SEARCH_GROUNDING_GEMINI_MODEL;
  try {
    if (value === undefined) delete process.env.SEARCH_GROUNDING_GEMINI_MODEL;
    else process.env.SEARCH_GROUNDING_GEMINI_MODEL = value;
    run();
  } finally {
    if (previous === undefined) delete process.env.SEARCH_GROUNDING_GEMINI_MODEL;
    else process.env.SEARCH_GROUNDING_GEMINI_MODEL = previous;
  }
}

test("tries Gemini 3.5 Flash-Lite before falling back to Gemini 3.5 Flash", () => {
  withModel("gemini-3.5-flash-lite", () => {
    assert.equal(searchGroundingModel(), "gemini-3.5-flash-lite");
    assert.deepEqual(searchGroundingModelCandidates(), [
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash",
    ]);
  });
});

test("keeps Gemini 3.5 Flash first when explicitly configured", () => {
  withModel("models/gemini-3.5-flash", () => {
    assert.deepEqual(searchGroundingModelCandidates(), [
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
    ]);
  });
});

test("retired or unsupported grounding models fall back to the supported pair", () => {
  withModel("gemini-2.5-flash-lite", () => {
    assert.equal(searchGroundingModel(), "gemini-3.5-flash-lite");
    assert.deepEqual(searchGroundingModelCandidates(), [
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash",
    ]);
  });
});
