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

const circular89Query = "thông tư 89 mới nhất";
const circular89 = await search(circular89Query, 1);
assert.equal(circular89.query_kind, "document");
assert.equal(circular89.document?.number, "89/2026/TT-BTC");
assert.equal(circular89.document?.status, "effective");
assert.match(circular89.document?.extraction_method ?? "", /docx/iu);
assert.match(circular89.document?.extraction_method ?? "", /doc/iu);
assert.ok((circular89.document?.official_text.length ?? 0) > 25_000, "Thông tư 89 chưa đọc nguồn chữ có cấu trúc.");
assert.match(circular89.document?.official_text ?? "", /Điều\s+101\b/iu);
assert.match(circular89.document?.official_text ?? "", /PHỤ LỤC KÈM THEO/iu);
assert.doesNotMatch(circular89.warnings.join(" "), /trang\s+48,\s*77,\s*96,\s*97/iu);

const circular90Query = "thông tư 90 năm 2026 bộ tài chính";
const circular90 = await search(circular90Query, 2);
assert.equal(circular90.query_kind, "document");
assert.equal(circular90.document?.number, "90/2026/TT-BTC");
assert.equal(circular90.document?.number.includes("2024"), false);
assert.equal(circular90.document?.verification_notes, null);

const circular82 = await search("82/2026/TT-BTC", 3);
assert.equal(circular82.document?.number, "82/2026/TT-BTC");
assert.equal(circular82.document?.verification_notes, null);

const article11 = circular82.document?.provisions.find((provision) => provision.identifier === "Điều 11");
assert.ok(article11, "Không tìm thấy Điều 11 sau khi dựng lại cấu trúc hiển thị.");
assert.doesNotMatch(article11.official_text, /KT\.\s*BỘ TRƯỞNG|THỨ TRƯỞNG|Phụ\s+lục|Mẫu\s+số\s+01/iu);
assert.ok(article11.official_text.length < 8_000, "Điều 11 vẫn đang nuốt phần ký hoặc toàn bộ phụ lục.");

const appendix = circular82.document?.provisions.find((provision) => provision.identifier === "Phụ lục");
assert.ok(appendix, "Phụ lục chưa được tách thành phần riêng.");
assert.match(appendix.official_text, /Phụ\s+lục|Mẫu\s+số\s+01/iu);

const circular94Query = "thông tư 94 năm 2026 bộ tài chính";
const circular94 = await search(circular94Query, 4);
assert.equal(circular94.query_kind, "document");
assert.equal(circular94.document?.number, "94/2026/TT-BTC");
assert.equal(circular94.document?.extraction_method, "ocr");
assert.equal(circular94.document?.status, "effective");
assert.ok((circular94.document?.official_text.length ?? 0) > 60_000, "Thông tư 94 không đọc revision OCR bền vững.");
assert.doesNotMatch(circular94.document?.official_text ?? "", /\*\*\s*Điều\s+\d+/iu);
for (const identifier of ["Điều 3", "Điều 4", "Điều 5"]) {
  assert.ok(
    circular94.document?.provisions.find((provision) => provision.identifier === identifier),
    `${identifier} của Thông tư 94 chưa được nhận diện sau chuẩn hóa OCR.`,
  );
}
const circular94Article3 = circular94.document?.provisions.find((provision) => provision.identifier === "Điều 3");
assert.match(circular94Article3?.heading ?? "", /Giải thích từ ngữ/iu);
assert.match(circular94Article3?.official_text ?? "", /Trong Thông tư này/iu);

const decree252Query = "Đọc nghị định 252";
const decree252 = await search(decree252Query, 5);
assert.equal(decree252.query_kind, "document");
assert.equal(decree252.document?.number, "252/2026/NĐ-CP");
assert.equal(decree252.document?.status, "effective");
assert.ok((decree252.document?.official_text.length ?? 0) > 100_000, "Nghị định 252 không đọc revision hiện hành đã nhập.");
assert.ok(
  decree252.document?.provisions.some((provision) => provision.identifier === "Điều 1"),
  "Nghị định 252 chưa có cấu trúc Điều sau tra cứu dạng rút gọn.",
);

const decree252Variant = await search("mở Nghị định số 252", 6);
assert.equal(decree252Variant.document?.number, "252/2026/NĐ-CP");

console.log(
  "[live-presentation-search-result]",
  JSON.stringify({
    circular89: {
      query: circular89Query,
      number: circular89.document?.number,
      characters: circular89.document?.official_text.length,
      provisionCount: circular89.document?.provisions.length,
      extractionMethod: circular89.document?.extraction_method,
      appendixIncluded: circular89.document?.official_text.includes("PHỤ LỤC KÈM THEO"),
      warnings: circular89.warnings,
    },
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
    circular94: {
      query: circular94Query,
      number: circular94.document?.number,
      characters: circular94.document?.official_text.length,
      provisionCount: circular94.document?.provisions.length,
      article3Heading: circular94Article3?.heading,
      markdownRemoved: !circular94.document?.official_text.includes("**"),
    },
    decree252: {
      query: decree252Query,
      number: decree252.document?.number,
      characters: decree252.document?.official_text.length,
      provisionCount: decree252.document?.provisions.length,
      status: decree252.document?.status,
    },
  }),
);
console.log("[live-presentation-search] structured fallback, current aliases, durable OCR and article reconstruction passed");
