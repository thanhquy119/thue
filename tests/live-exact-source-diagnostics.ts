import {
  discoverExactGazetteSources,
} from "../lib/legal/exact-official-document-resolver.ts";
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

async function inspectGazetteApi(number: string) {
  const startedAt = Date.now();
  try {
    const response = await fetch("https://api-searchcongbao.chinhphu.vn/search/van-ban", {
      method: "POST",
      cache: "no-store",
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
        accept: "application/json",
        "content-type": "application/json",
        origin: "https://congbao.chinhphu.vn",
        referer: "https://congbao.chinhphu.vn/",
      },
      body: JSON.stringify({ filters: {}, page: 1, page_size: 30, query: number }),
    });
    const text = await response.text();
    let shape: unknown = null;
    try {
      const payload = JSON.parse(text) as Record<string, unknown>;
      const data = payload.data;
      shape = {
        topLevelKeys: Object.keys(payload),
        dataType: Array.isArray(data) ? "array" : typeof data,
        dataKeys: data && !Array.isArray(data) && typeof data === "object"
          ? Object.keys(data as Record<string, unknown>)
          : [],
        firstRecordKeys: Array.isArray(data) && data[0] && typeof data[0] === "object"
          ? Object.keys(data[0] as Record<string, unknown>)
          : [],
      };
    } catch {
      // Keep the response preview for non-JSON diagnostics.
    }
    console.log("[live-gazette-api]", JSON.stringify({
      number,
      durationMs: Date.now() - startedAt,
      status: response.status,
      contentType: response.headers.get("content-type"),
      shape,
      preview: text.slice(0, 4_000),
    }));
  } catch (error) {
    console.warn("[live-gazette-api-error]", JSON.stringify({
      number,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

async function main() {
  if (!enabled) return;
  const number = "253/2026/NĐ-CP";
  await inspectGazetteApi(number);
  try {
    const gazette = await discoverExactGazetteSources(number);
    console.log("[live-exact-gazette-sources]", JSON.stringify({
      number,
      sourceCount: gazette.length,
      sources: gazette.map((source, index) => ({
        index,
        officialPageUrl: source.officialPageUrl,
        ...safeUrlSummary(source.sourceUrl),
      })),
    }));
  } catch (error) {
    console.warn("[live-exact-gazette-error]", JSON.stringify({
      number,
      error: error instanceof Error ? error.message : String(error),
    }));
  }

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
