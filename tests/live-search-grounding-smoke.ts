import assert from "node:assert/strict";
import { isAllowedLegalSource } from "../lib/legal/ingestion.ts";
import {
  extractGroundingWebChunks,
  isGroundingRedirectUrl,
} from "../lib/legal/search-grounding-fallback.ts";

const marker = process.env.VERCEL_GIT_COMMIT_MESSAGE || process.env.GITHUB_COMMIT_MESSAGE || "";
const enabled =
  process.env.RUN_LIVE_SEARCH_GROUNDING === "true" ||
  marker.includes("[live-grounding]");

if (!enabled) {
  console.log("[live-grounding] skipped; add [live-grounding] to the commit message or set RUN_LIVE_SEARCH_GROUNDING=true.");
  process.exit(0);
}

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
assert.ok(apiKey, "Gemini API key is required for the live grounding smoke.");

const model = "gemini-2.5-flash-lite";
const query = "Tìm trang văn bản chính thức của Chính phủ Việt Nam về đăng ký thuế khi doanh nghiệp chuyển trụ sở sang tỉnh khác. Chỉ tìm nguồn cơ quan nhà nước.";

const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: query }] }],
      tools: [{ google_search: {} }],
      generationConfig: { maxOutputTokens: 256 },
    }),
  },
);

const payload = await response.json().catch(() => ({})) as {
  error?: { message?: unknown; details?: unknown };
  candidates?: unknown[];
};
const message = typeof payload.error?.message === "string" ? payload.error.message : "";
console.log(`[live-grounding-model] model=${model} status=${response.status}`);
assert.equal(
  response.ok,
  true,
  `Gemini 2.5 Flash-Lite Search Grounding failed (${response.status}): ${message.slice(0, 400)}`,
);

const chunks = extractGroundingWebChunks(payload);
assert.ok(chunks.length >= 1, "Grounding response did not contain any web citation.");

async function resolveOfficialUrl(value: string) {
  if (isAllowedLegalSource(value)) return value;
  if (!isGroundingRedirectUrl(value)) return "";
  let current = value;
  for (let index = 0; index < 3; index += 1) {
    const redirect = await fetch(current, { redirect: "manual" });
    const location = redirect.headers.get("location");
    if (!location) return isAllowedLegalSource(redirect.url || current) ? redirect.url || current : "";
    const next = new URL(location, current).toString();
    if (isAllowedLegalSource(next)) return next;
    if (!isGroundingRedirectUrl(next)) return "";
    current = next;
  }
  return "";
}

const officialUrls = (
  await Promise.all(chunks.map((chunk) => resolveOfficialUrl(chunk.uri).catch(() => "")))
).filter(Boolean);
assert.ok(officialUrls.length >= 1, "Grounding did not resolve to an allowed official government source.");

console.log(
  `[live-grounding] model=${model} groundedPrompts=1 citations=${chunks.length} officialSources=${officialUrls.length} hosts=${[
    ...new Set(officialUrls.map((url) => new URL(url).hostname)),
  ].join(",")}`,
);
