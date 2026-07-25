import { discoverExactOfficialSourcesSafe } from "../lib/legal/exact-official-document-safe.ts";
import { extractDurableLegalSource } from "../lib/legal/durable-extraction.ts";

const enabled = process.env.RUN_LIVE_EXACT_DOCUMENTS === "true" ||
  (process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "").includes("[live-exact-documents]");

function safeUrlSummary(value: string) {
  const url = new URL(value);
  return {
    host: url.hostname,
    pathname: url.pathname,
    fileName: url.searchParams.get("file_name"),
    hasOpaqueToken: url.searchParams.has("Url"),
    url: value,
  };
}

async function main() {
  if (!enabled) return;
  const number = "253/2026/NĐ-CP";
  const sources = await discoverExactOfficialSourcesSafe(number);
  console.log("[live-exact-source-diagnostics]", JSON.stringify({
    number,
    sourceCount: sources.length,
    sources: sources.map((source, index) => ({
      index,
      officialPageUrl: source.officialPageUrl,
      ...safeUrlSummary(source.sourceUrl),
    })),
  }));

  for (const [index, source] of sources.slice(0, 12).entries()) {
    const startedAt = Date.now();
    try {
      const extracted = await extractDurableLegalSource(source.sourceUrl);
      console.log("[live-exact-source-result]", JSON.stringify({
        number,
        index,
        durationMs: Date.now() - startedAt,
        sourceUrl: source.sourceUrl,
        resolvedUrl: extracted.sourceUrl,
        mimeType: extracted.mimeType,
        fileName: extracted.fileName,
        extractionMethod: extracted.extractionMethod,
        requiresOcr: extracted.requiresOcr,
        characters: extracted.officialText.length,
        qualityScore: extracted.qualityScore,
        totalPages: extracted.totalPages,
      }));
    } catch (error) {
      console.warn("[live-exact-source-error]", JSON.stringify({
        number,
        index,
        durationMs: Date.now() - startedAt,
        sourceUrl: source.sourceUrl,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
}

main().catch((error) => {
  console.error("[live-exact-source-diagnostics] failed", error);
  process.exitCode = 1;
});
