import { discoverExactGazetteSources } from "../lib/legal/exact-official-document-resolver.ts";
import { discoverExactOfficialSourcesSafe } from "../lib/legal/exact-official-document-safe.ts";
import { normalizeDocumentNumber } from "../lib/legal/durable-ingestion-types.ts";

const enabled = process.env.RUN_LIVE_EXACT_DOCUMENTS === "true" ||
  (process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "").includes("[live-exact-documents]");

const GAZETTE_URL = "https://api-searchcongbao.chinhphu.vn/search/van-ban";
const COMMON_REQUEST = { page: 1, page_size: 30 };

const REQUEST_VARIANTS: Array<{ name: string; body: Record<string, unknown> }> = [
  { name: "query", body: { ...COMMON_REQUEST, filters: {}, query: "253/2026/NĐ-CP" } },
  { name: "keyword", body: { ...COMMON_REQUEST, filters: {}, keyword: "253/2026/NĐ-CP" } },
  { name: "search", body: { ...COMMON_REQUEST, filters: {}, search: "253/2026/NĐ-CP" } },
  { name: "search_text", body: { ...COMMON_REQUEST, filters: {}, search_text: "253/2026/NĐ-CP" } },
  { name: "text_search", body: { ...COMMON_REQUEST, filters: {}, text_search: "253/2026/NĐ-CP" } },
  { name: "tu_khoa", body: { ...COMMON_REQUEST, filters: {}, tu_khoa: "253/2026/NĐ-CP" } },
  { name: "filter_so_ky_hieu", body: { ...COMMON_REQUEST, filters: { so_ky_hieu: "253/2026/NĐ-CP" } } },
  { name: "filter_keyword", body: { ...COMMON_REQUEST, filters: { keyword: "253/2026/NĐ-CP" } } },
];

function exactRecords(data: unknown, number: string) {
  if (!Array.isArray(data)) return [];
  const expected = normalizeDocumentNumber(number);
  return data
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .filter((item) => normalizeDocumentNumber(String(item.so_ky_hieu ?? "")) === expected)
    .map((item) => ({
      id_van_ban: item.id_van_ban,
      so_ky_hieu: item.so_ky_hieu,
      attachments: Array.isArray(item.danh_sach_tep_van_ban)
        ? item.danh_sach_tep_van_ban.map((attachment) => {
            const value = attachment as Record<string, unknown>;
            return {
              duong_dan: value.duong_dan,
              file_extension: value.file_extension,
              ten_file: value.ten_file,
            };
          })
        : [],
    }));
}

async function postVariant(name: string, body: Record<string, unknown>, number: string) {
  const startedAt = Date.now();
  try {
    const response = await fetch(GAZETTE_URL, {
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
      body: JSON.stringify(body),
    });
    const payload = await response.json() as Record<string, unknown>;
    const data = payload.data;
    console.log("[live-gazette-request-variant]", JSON.stringify({
      name,
      durationMs: Date.now() - startedAt,
      status: response.status,
      total: payload.total,
      pagination: payload.pagination,
      dataCount: Array.isArray(data) ? data.length : null,
      firstNumbers: Array.isArray(data)
        ? data.slice(0, 5).map((item) => String((item as Record<string, unknown>).so_ky_hieu ?? ""))
        : [],
      exactRecords: exactRecords(data, number),
    }));
  } catch (error) {
    console.warn("[live-gazette-request-variant-error]", JSON.stringify({
      name,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

async function main() {
  if (!enabled) return;
  const number = "253/2026/NĐ-CP";
  for (const variant of REQUEST_VARIANTS) await postVariant(variant.name, variant.body, number);

  try {
    const gazette = await discoverExactGazetteSources(number);
    console.log("[live-exact-gazette-sources]", JSON.stringify({
      number,
      sourceCount: gazette.length,
      sources: gazette.map((source) => source.sourceUrl),
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
    sources: sources.map((source) => ({
      sourceUrl: source.sourceUrl,
      officialPageUrl: source.officialPageUrl,
    })),
  }));
}

main().catch((error) => {
  console.error("[live-exact-source-diagnostics] failed", error);
  process.exitCode = 1;
});
