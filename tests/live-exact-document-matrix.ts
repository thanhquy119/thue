import assert from "node:assert/strict";
import { looksLikeGovernmentPortalShell } from "../lib/legal/document-quality.ts";
import {
  discoverExactOfficialSources,
  loadExactOfficialDocument,
} from "../lib/legal/exact-official-document-resolver.ts";
import { normalizeDocumentNumber } from "../lib/legal/durable-ingestion-types.ts";

const COMMIT_MARKER = "[live-exact-documents]";
const enabled = process.env.RUN_LIVE_EXACT_DOCUMENTS === "true" ||
  (process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "").includes(COMMIT_MARKER);

const DOCUMENTS = [
  { number: "252/2026/NĐ-CP", minimumCharacters: 8_000 },
  { number: "253/2026/NĐ-CP", minimumCharacters: 8_000 },
  { number: "254/2026/NĐ-CP", minimumCharacters: 8_000 },
  { number: "256/2026/NĐ-CP", minimumCharacters: 5_000 },
  { number: "90/2026/TT-BTC", minimumCharacters: 8_000 },
  { number: "108/2025/QH15", minimumCharacters: 8_000 },
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

    console.log("[live-exact-document-sources]", JSON.stringify({
      number: definition.number,
      sources: sources.slice(0, 5).map((source) => source.sourceUrl),
    }));

    const document = await retry(`${definition.number} extraction`, () => loadExactOfficialDocument(definition.number));
    assert.ok(document, `${definition.number}: exact resolver did not produce full text`);
    assert.equal(normalizeDocumentNumber(document.number), normalizeDocumentNumber(definition.number));
    assert.ok(
      document.official_text.length >= definition.minimumCharacters,
      `${definition.number}: full text is unexpectedly short (${document.official_text.length})`,
    );
    assert.equal(looksLikeGovernmentPortalShell(document.official_text), false);
    assert.notEqual(document.extraction_method, "html", `${definition.number}: portal HTML was used as full text`);
    assert.ok(document.provisions.length >= 2, `${definition.number}: legal hierarchy is missing`);
    assert.ok(
      document.provisions.some((provision) => provision.type === "article"),
      `${definition.number}: no Article provision was parsed`,
    );

    console.log("[live-exact-document-case]", JSON.stringify({
      number: document.number,
      title: document.title,
      sourceUrl: document.source_url,
      sourceCount: sources.length,
      extractionMethod: document.extraction_method,
      characters: document.official_text.length,
      provisions: document.provisions.length,
    }));
  }

  console.log(`[live-exact-documents] passed ${DOCUMENTS.length}/${DOCUMENTS.length} official documents`);
}

main().catch((error) => {
  console.error("[live-exact-documents] failed", error);
  process.exitCode = 1;
});
