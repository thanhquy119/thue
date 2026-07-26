import assert from "node:assert/strict";
import { isAllowedLegalSource } from "../lib/legal/ingestion.ts";
import {
  discoverOfficialSourcesViaGrounding,
  searchGroundingEnabled,
  searchGroundingMode,
  searchGroundingModel,
  searchGroundingModelCandidates,
  searchGroundingUsable,
} from "../lib/legal/search-grounding-fallback.ts";

const marker = process.env.VERCEL_GIT_COMMIT_MESSAGE || process.env.GITHUB_COMMIT_MESSAGE || "";
const enabled =
  process.env.RUN_LIVE_SEARCH_GROUNDING === "true" ||
  marker.includes("[live-grounding]");

if (!enabled) {
  console.log("[live-grounding] skipped; add [live-grounding] to the commit message or set RUN_LIVE_SEARCH_GROUNDING=true.");
  process.exit(0);
}

// Live verification deliberately bypasses adaptive selection and exercises the provider directly.
process.env.SEARCH_GROUNDING_MODE = "always";
assert.equal(searchGroundingMode(), "always");
assert.equal(searchGroundingEnabled(), true);
assert.equal(searchGroundingUsable(), true, "Gemini API key is required for the live grounding smoke.");

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const candidateModels = searchGroundingModelCandidates();
let availableModel = "";
let interactionsModel = "";
const probeStatuses: string[] = [];

for (const model of candidateModels) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Tìm một trang chính thức của Chính phủ Việt Nam về đăng ký thuế." }] }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: 256 },
      }),
    },
  );
  const payload = await response.json().catch(() => ({})) as { error?: { message?: unknown } };
  const message = typeof payload.error?.message === "string" ? payload.error.message.slice(0, 120) : "";
  probeStatuses.push(`generateContent/${model}:${response.status}${message ? `:${message}` : ""}`);
  console.log(`[live-grounding-model] transport=generateContent model=${model} status=${response.status}`);
  if (response.ok) {
    availableModel = model;
    break;
  }
}

if (!availableModel) {
  for (const model of candidateModels) {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model,
        input: "Tìm một trang chính thức của Chính phủ Việt Nam về đăng ký thuế.",
        tools: [{ type: "google_search" }],
      }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: { message?: unknown } };
    const message = typeof payload.error?.message === "string" ? payload.error.message.slice(0, 120) : "";
    probeStatuses.push(`interactions/${model}:${response.status}${message ? `:${message}` : ""}`);
    console.log(`[live-grounding-model] transport=interactions model=${model} status=${response.status}`);
    if (response.ok) {
      interactionsModel = model;
      break;
    }
  }
}

assert.ok(
  availableModel || interactionsModel,
  `No configured Gemini model can use Search Grounding: ${probeStatuses.join(" | ")}`,
);
assert.ok(
  availableModel,
  `Interactions API works with ${interactionsModel}, but the production Grounding adapter still needs migration.`,
);
process.env.SEARCH_GROUNDING_GEMINI_MODEL = availableModel;

const queries = [
  "Quy định thuế Việt Nam hiện hành về đăng ký thuế khi doanh nghiệp chuyển trụ sở sang tỉnh khác",
  "Hướng dẫn chỉ tiêu 37 và 38 tại Mẫu 01/GTGT ban hành kèm Thông tư 89/2026/TT-BTC",
];
const allSources = [];

for (const query of queries) {
  const sources = await discoverOfficialSourcesViaGrounding(query);
  assert.ok(sources.length >= 1, `Search Grounding did not return an official legal source for: ${query}`);
  assert.ok(sources.length <= 10, "Search Grounding returned more sources than the safety cap.");
  for (const source of sources) {
    assert.equal(isAllowedLegalSource(source.url), true, `Non-official URL escaped the allowlist: ${source.url}`);
    assert.match(source.source_label, /Search Grounding/iu);
    allSources.push(source);
  }
}

const usedModels = [
  ...new Set(
    allSources
      .map((source) => source.source_label.match(/\((gemini-[^)]+)\)/iu)?.[1] ?? "")
      .filter(Boolean),
  ),
];
assert.ok(usedModels.length >= 1, "Grounding sources did not record the model that produced them.");
for (const model of usedModels) {
  assert.ok(candidateModels.includes(model), `Grounding used an unsupported model: ${model}`);
}

console.log(
  `[live-grounding] mode=${searchGroundingMode()} configured=${searchGroundingModel()} available=${availableModel} candidates=${candidateModels.join(",")} used=${usedModels.join(",")} queries=${queries.length} officialSources=${allSources.length} hosts=${[
    ...new Set(allSources.map((source) => new URL(source.url).hostname)),
  ].join(",")}`,
);
