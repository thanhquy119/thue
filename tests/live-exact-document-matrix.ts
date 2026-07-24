import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { POST as searchApiPost } from "../app/api/search/route.ts";
import { looksLikeGovernmentPortalShell } from "../lib/legal/document-quality.ts";
import {
  discoverExactOfficialSources,
  loadExactOfficialDocument,
} from "../lib/legal/exact-official-document-resolver.ts";
import { normalizeDocumentNumber } from "../lib/legal/durable-ingestion-types.ts";
import type { TaxSearchResponse } from "../lib/legal/types.ts";

const COMMIT_MARKER = "[live-exact-documents]";
const enabled = process.env.RUN_LIVE_EXACT_DOCUMENTS === "true" ||
  (process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "").includes(COMMIT_MARKER);

const DOCUMENTS = [
  { number: "252/2026/NĐ-CP", minimumCharacters: 8_000 },
  { number: "253/2026/NĐ-CP", minimumCharacters: 8_000 },
  { number: "254/2026/NĐ-CP", minimumCharacters: 8_000 },
  { number: "256/2026/NĐ-CP", minimumCharacters: 5_000 },
  { number: "90/2026/TT-BTC", minimumCharacters: 8_000 },
  { number: "91/2026/TT-BTC", minimumCharacters: 5_000 },
  { number: "108/2025/QH15", minimumCharacters: 8_000 },
] as const;

const SEARCH_CASES = [
  { query: "254/2026/NĐ-CP", expected: "254/2026/NĐ-CP" },
  { query: "254/2026/ND-CP", expected: "254/2026/NĐ-CP" },
  { query: "Nghị định 254 năm 2026", expected: "254/2026/NĐ-CP" },
  { query: "nghi dinh so 254 nam 2026", expected: "254/2026/NĐ-CP" },
  { query: "252/2026/NĐ-CP", expected: "252/2026/NĐ-CP" },
  { query: "Thông tư 91 năm 2026 Bộ Tài chính", expected: "91/2026/TT-BTC" },
  { query: "108/2025/QH15", expected: "108/2025/QH15" },
] as const;

async function retry<T>(label: string, operation: () => Promise<T>, attempts = 2) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.warn(`[live-exact-retry] ${label} attempt=${attempt}`, error);
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1_500 * attempt));
    }
  }
  throw lastError;
}

async function callSearchApi(query: string) {
  const fingerprint = randomUUID();
  const response = await searchApiPost(new Request("https://preview.thue-ro.local/api/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
      "x-vercel-ip-country": "VN",
      "x-thue-ro-smoke-fingerprint": fingerprint,
      "user-agent": `thue-ro-exact-smoke/${fingerprint}`,
    },
    body: JSON.stringify({ query }),
  }));
  if (response.status !== 200) {
    throw new Error(`POST /api/search trả ${response.status} cho ${query}: ${(await response.text()).slice(0, 600)}`);
  }
  return (await response.json()) as TaxSearchResponse;
}

function assertUsableDocument(document: NonNullable<TaxSearchResponse["document"]>, expected: string, minimumCharacters = 5_000) {
  assert.equal(normalizeDocumentNumber(document.number), normalizeDocumentNumber(expected));
  assert.ok(document.official_text.length >= minimumCharacters, `${expected}: API full text quá ngắn (${document.official_text.length})`);
  assert.equal(looksLikeGovernmentPortalShell(document.official_text), false, `${expected}: API trả portal shell`);
  assert.ok(document.provisions.some((provision) => provision.type === "article"), `${expected}: API thiếu Điều`);
}

async function main() {
  if (!enabled) {
    console.log(`[live-exact-documents] skipped; add ${COMMIT_MARKER} to the commit message or set RUN_LIVE_EXACT_DOCUMENTS=true.`);
    return;
  }

  process.env.LEGAL_MAX_SOURCE_BYTES ||= "100000000";
  console.log("[live-exact-documents] starting exact official-source matrix");

  for (const definition of DOCUMENTS) {
    const sources = await retry(`${definition.number} discovery`, () => discoverExactOfficialSources(definition.number));
    assert.ok(sources.length > 0, `${definition.number}: no exact official source`);
    assert.ok(
      sources.every((source) => normalizeDocumentNumber(source.number) === normalizeDocumentNumber(definition.number)),
      `${definition.number}: discovery returned a near-match document`,
    );
    assert.ok(
      sources.every((source) => {
        const host = new URL(source.sourceUrl).hostname.toLocaleLowerCase("en");
        return host === "chinhphu.vn" || host.endsWith(".chinhphu.vn");
      }),
      `${definition.number}: discovery returned a non-official host`,
    );

    const document = await retry(`${definition.number} extraction`, () => loadExactOfficialDocument(definition.number));
    assert.ok(document, `${definition.number}: exact resolver did not produce full text`);
    assert.equal(normalizeDocumentNumber(document.number), normalizeDocumentNumber(definition.number));
    assert.ok(document.official_text.length >= definition.minimumCharacters, `${definition.number}: full text is unexpectedly short (${document.official_text.length})`);
    assert.equal(looksLikeGovernmentPortalShell(document.official_text), false);
    assert.notEqual(document.extraction_method, "html", `${definition.number}: portal HTML was used as full text`);
    assert.ok(document.provisions.length >= 2, `${definition.number}: legal hierarchy is missing`);
    assert.ok(document.provisions.some((provision) => provision.type === "article"), `${definition.number}: no Article provision was parsed`);

    console.log("[live-exact-document-case]", JSON.stringify({
      number: document.number,
      sourceUrl: document.source_url,
      sourceCount: sources.length,
      extractionMethod: document.extraction_method,
      characters: document.official_text.length,
      provisions: document.provisions.length,
    }));
  }

  for (const searchCase of SEARCH_CASES) {
    const result = await retry(`POST /api/search ${searchCase.query}`, () => callSearchApi(searchCase.query));
    assert.ok(result.document, `${searchCase.query}: API không trả document`);
    assertUsableDocument(result.document, searchCase.expected);
    console.log("[live-exact-search-case]", JSON.stringify({
      query: searchCase.query,
      expected: searchCase.expected,
      actual: result.document.number,
      extractionMethod: result.document.extraction_method,
      characters: result.document.official_text.length,
      confidence: result.confidence,
    }));
  }

  console.log(`[live-exact-documents] passed ${DOCUMENTS.length}/${DOCUMENTS.length} official documents and ${SEARCH_CASES.length}/${SEARCH_CASES.length} POST /api/search cases`);
}

main().catch((error) => {
  console.error("[live-exact-documents] failed", error);
  process.exitCode = 1;
});
