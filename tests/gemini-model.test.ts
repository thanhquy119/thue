import assert from "node:assert/strict";
import test from "node:test";
import { geminiModel, geminiModelCandidates } from "../lib/legal/gemini.ts";

test("uses Gemini 3.5 Flash-Lite by default", () => {
  const previous = process.env.GEMINI_MODEL;
  delete process.env.GEMINI_MODEL;
  try {
    assert.equal(geminiModel(), "gemini-3.5-flash-lite");
    assert.equal(geminiModelCandidates()[0], "gemini-3.5-flash-lite");
  } finally {
    if (previous === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previous;
  }
});

test("keeps Gemini 3.5 Flash-Lite first when an older model is configured", () => {
  const previous = process.env.GEMINI_MODEL;
  process.env.GEMINI_MODEL = "gemini-3.1-flash-lite";
  try {
    assert.deepEqual(geminiModelCandidates().slice(0, 2), [
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite",
    ]);
  } finally {
    if (previous === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previous;
  }
});
