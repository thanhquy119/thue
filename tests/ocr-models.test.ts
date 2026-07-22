import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeOcrModelChoice,
  ocrModelCandidates,
  ocrModelResultLabel,
} from "../lib/legal/ocr-models.ts";

test("defaults OCR to Gemini 3.5 Flash-Lite", () => {
  assert.equal(normalizeOcrModelChoice(undefined), "auto");
  assert.equal(ocrModelCandidates("auto")[0], "gemini-3.5-flash-lite");
  assert.equal(ocrModelResultLabel("auto"), "auto · gemini-3.5-flash-lite");
});

test("allows explicit Gemini 3.6 Flash with safe fallback", () => {
  assert.deepEqual(
    ocrModelCandidates("gemini-3.6-flash"),
    ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
  );
});

test("ignores unsupported model injection", () => {
  assert.equal(normalizeOcrModelChoice("gemini-pro-unknown"), "auto");
  assert.equal(ocrModelCandidates("auto", "gemini-pro-unknown").includes("gemini-pro-unknown"), false);
});
