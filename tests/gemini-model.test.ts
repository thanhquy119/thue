import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../lib/legal/gemini.ts", import.meta.url), "utf8");
const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

test("uses Gemini 3.5 Flash-Lite as the grounded-answer default", () => {
  assert.match(source, /const DEFAULT_GEMINI_MODEL = "gemini-3\.5-flash-lite"/u);
  assert.match(source, /new Set\(\[DEFAULT_GEMINI_MODEL, geminiModel\(\), \.\.\.GEMINI_FALLBACK_MODELS\]\)/u);
});

test("documents Gemini 3.5 Flash-Lite for both answer and OCR paths", () => {
  assert.match(envExample, /^GEMINI_MODEL=gemini-3\.5-flash-lite$/mu);
  assert.match(envExample, /^OCR_GEMINI_MODEL=gemini-3\.5-flash-lite$/mu);
});
