import assert from "node:assert/strict";
import { POST as searchApiPost } from "../app/api/search/route.ts";
import type { TaxSearchResponse } from "../lib/legal/types.ts";

const MARKER = "[live-presentation-search]";
const enabled =
  process.env.RUN_LIVE_PRESENTATION_SEARCH_SMOKE === "true" ||
  (process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "").includes(MARKER);

if (!enabled) {
  console.log(`[live-presentation-search] skipped; add ${MARKER} to the commit message or set RUN_LIVE_PRESENTATION_SEARCH_SMOKE=true.`);
  process.exit(0);
}

async function search(query: string, requestIndex: number) {
  const response = await searchApiPost(
    new Request("https://preview.thue-ro.local/api/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `203.0.113.${40 + requestIndex}`,
        "user-agent": `ThueRo-LivePresentationSmoke/${requestIndex}`,
      },
      body: JSON.stringify({ query }),
    }),
  );
  if (response.status !== 200) {
    throw new Error(`${query} trả ${response.status}: ${(await response.text()).slice(0, 1_200)}`);
  }
  return (await response.json()) as TaxSearchResponse;
}

const circular90Query = "thông tư 90 năm 2026 bộ tài chính";
const circular90 = await search(circular90Query, 1);
assert.equal(circular90.query_kind, "document");
assert.equal(circular90.document?.number, "90/2026/TT-BTC");
assert.equal(circular90.document?.number.includes("2024"), false);
assert.equal(circular90.document?.verification_notes, null);

const circular82 = await search("82/2026/TT-BTC", 2);
assert.equal(circular82.document?.number, "82/2026/TT-BTC");
assert.equal(circular82.document?.verification_notes, null);

const article11 = circular82.document?.provisions.find((provision) => provision.identifier === "Điều 11");
assert.ok(article11, "Không tìm thấy Điều 11 sau khi dựng lại cấu trúc hiển thị.");
assert.doesNotMatch(article11.official_text, /KT\.\s*BỘ TRƯỞNG|THỨ TRƯỞNG|Phụ\s+lục|Mẫu\s+số\s+01/iu);
assert.ok(article11.official_text.length < 8_000, "Điều 11 vẫn đang nuốt phần ký hoặc toàn bộ phụ lục.");

const appendix = circular82.document?.provisions.find((provision) => provision.identifier === "Phụ lục");
assert.ok(appendix, "Phụ lục chưa được tách thành phần riêng.");
assert.match(appendix.official_text, /Phụ\s+lục|Mẫu\s+số\s+01/iu);

console.log(
  "[live-presentation-search-result]",
  JSON.stringify({
    circular90: {
      query: circular90Query,
      number: circular90.document?.number,
      title: circular90.document?.title,
      verificationNotes: circular90.document?.verification_notes,
    },
    circular82: {
      number: circular82.document?.number,
      provisionCount: circular82.document?.provisions.length,
      article11Characters: article11.official_text.length,
      article11Ending: article11.official_text.slice(-240),
      signatureSeparated: Boolean(
        circular82.document?.provisions.find((provision) => provision.identifier === "Phần ký và nơi nhận"),
      ),
      appendixCharacters: appendix.official_text.length,
      verificationNotes: circular82.document?.verification_notes,
    },
  }),
);
console.log("[live-presentation-search] exact-year routing, hidden technical notes and final-article repair passed");
