import assert from "node:assert/strict";
import { isAllowedLegalSource } from "../lib/legal/ingestion.ts";
import {
  discoverOfficialSourcesViaGrounding,
  searchGroundingEnabled,
  searchGroundingModel,
  searchGroundingModelCandidates,
} from "../lib/legal/search-grounding-fallback.ts";

const marker = process.env.VERCEL_GIT_COMMIT_MESSAGE || process.env.GITHUB_COMMIT_MESSAGE || "";
const enabled =
  process.env.RUN_LIVE_SEARCH_GROUNDING === "true" ||
  marker.includes("[live-grounding]");

if (!enabled) {
  console.log("[live-grounding] skipped; add [live-grounding] to the commit message or set RUN_LIVE_SEARCH_GROUNDING=true.");
  process.exit(0);
}

assert.equal(
  searchGroundingEnabled(),
  true,
  "ENABLE_SEARCH_GROUNDING_FALLBACK must be true for the live grounding smoke.",
);

const sources = await discoverOfficialSourcesViaGrounding(
  "Quy định thuế Việt Nam hiện hành về đăng ký thuế khi doanh nghiệp chuyển trụ sở sang tỉnh khác",
);

assert.ok(sources.length >= 1, "Search Grounding did not return an official legal source.");
assert.ok(sources.length <= 10, "Search Grounding returned more sources than the safety cap.");
for (const source of sources) {
  assert.equal(isAllowedLegalSource(source.url), true, `Non-official URL escaped the allowlist: ${source.url}`);
  assert.match(source.source_label, /Search Grounding/iu);
}

const candidateModels = searchGroundingModelCandidates();
const usedModels = [
  ...new Set(
    sources
      .map((source) => source.source_label.match(/\((gemini-[^)]+)\)/iu)?.[1] ?? "")
      .filter(Boolean),
  ),
];
assert.ok(usedModels.length >= 1, "Grounding sources did not record the model that produced them.");
for (const model of usedModels) {
  assert.ok(candidateModels.includes(model), `Grounding used an unsupported model: ${model}`);
}

console.log(
  `[live-grounding] configured=${searchGroundingModel()} candidates=${candidateModels.join(",")} used=${usedModels.join(",")} officialSources=${sources.length} hosts=${[
    ...new Set(sources.map((source) => new URL(source.url).hostname)),
  ].join(",")}`,
);
