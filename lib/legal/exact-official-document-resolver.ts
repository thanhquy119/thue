import { randomUUID } from "node:crypto";
import { unstable_cache } from "next/cache";
import { discoverOfficialSources } from "./discovery.ts";
import { hasUsableLegalDocumentText, looksLikeGovernmentPortalShell } from "./document-quality.ts";
import {
  durableStoreAccess,
  durableStoreConfigured,
  readDurableIngestionState,
  readDurableRevision,
  writeDurableIngestionState,
} from "./durable-document-store.ts";
import { extractDurableLegalSource, type DurableExtractedSource } from "./durable-extraction.ts";
import { fetchDurableLegalBuffer } from "./durable-fetch.ts";
import {
  documentStorageKey,
  normalizeDocumentNumber,
  validateDurableLegalText,
  type DurableIngestionState,
  type DurableLegalSource,
} from "./durable-ingestion-types.ts";
import {
  canonicalExactDocumentNumber,
  extractOfficialAttachmentUrls,
  shouldQueueExactIngestion,
} from "./exact-official-document-core.ts";
import { isAllowedLegalSource, parseLegalHierarchy, slugifyDocument } from "./ingestion.ts";
import { normalizeLegalQuery } from "./query.ts";
import { durableSourceFromDiscovery } from "./recent-tax-discovery-core.ts";
import type { DocumentDetail, SearchCandidate, TaxSearchResponse } from "./types.ts";

const GAZETTE_SEARCH_URL = "https://api-searchcongbao.chinhphu.vn/search/van-ban";
const GAZETTE_ORIGINS = [
  "https://congbao.chinhphu.vn",
  "https://api-searchcongbao.chinhphu.vn",
] as const;
const DOCUMENT_REVALIDATE_SECONDS = 7 * 24 * 60 * 60;
const COMMON_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
  "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
};

type UnknownRecord = Record<string, unknown>;

type GazettePayload = {
  success?: boolean;
  data?: UnknownRecord[];
};

type ExactResolution = {
  document: DocumentDetail | null;
  source: DurableLegalSource | null;
  warnings: string[];
};

type QueueResult = {
  status: "started" | "processing" | "cooldown" | "unavailable" | "failed";
  state: DurableIngestionState | null;
};

function normalizeFullNumber(value: string) {
  return value
    .replace(/ND-CP/giu, "NĐ-CP")
    .replace(/QD-/giu, "QĐ-")
    .replace(/\s+/g, "")
    .toLocaleUpperCase("vi");
}

function stringValue(record: UnknownRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function dateValue(record: UnknownRecord, ...keys: string[]) {
  const value = stringValue(record, ...keys);
  if (!value) return null;
  if (/^20\d{2}-\d{2}-\d{2}/u.test(value)) return value.slice(0, 10);
  const match = value.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/u);
  if (!match) return null;
  return `${match[3]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[1])).padStart(2, "0")}`;
}

function issuerValue(record: UnknownRecord, number: string) {
  const raw = record.ten_co_quan ?? record.co_quan_ban_hanh ?? record.issuer;
  if (Array.isArray(raw)) {
    const value = raw.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).join(", ");
    if (value) return value;
  }
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (/TT-BTC$/iu.test(number)) return "Bộ Tài chính";
  if (/NĐ-CP$/iu.test(number) || /NQ-CP$/iu.test(number)) return "Chính phủ";
  if (/QĐ-TTg$/iu.test(number)) return "Thủ tướng Chính phủ";
  if (/\/(?:QH|UBTVQH)\d*$/iu.test(number)) return "Quốc hội";
  return "";
}

function typeValue(record: UnknownRecord, number: string) {
  const stated = stringValue(record, "loai_van_ban", "document_type", "type");
  if (stated) return stated;
  if (/\/NĐ-CP$/iu.test(number)) return "Nghị định";
  if (/\/TT-/iu.test(number)) return "Thông tư";
  if (/\/NQ-/iu.test(number)) return "Nghị quyết";
  if (/\/QĐ-/iu.test(number)) return "Quyết định";
  if (/\/(?:QH|UBTVQH)\d*$/iu.test(number)) return "Luật/Nghị quyết";
  return "Văn bản pháp luật";
}

function titleValue(record: UnknownRecord, number: string) {
  return stringValue(record, "trich_yeu", "tieu_de", "title") || `Văn bản số ${number}`;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&nbsp;/giu, " ");
}

function safeOfficialUrl(value: string, base: string) {
  const raw = decodeHtml(value.trim());
  if (!raw) return null;
  try {
    const prepared = raw.startsWith("//")
      ? `https:${raw}`
      : /^[a-z0-9.-]+\.chinhphu\.vn\//iu.test(raw)
        ? `https://${raw}`
        : raw;
    const url = new URL(prepared, base).toString();
    return isAllowedLegalSource(url) ? url : null;
  } catch {
    return null;
  }
}

function sourcePriority(url: string) {
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    // Keep the encoded URL.
  }
  const lower = decoded.toLocaleLowerCase("en");
  if (/\.docx(?:$|[?&#])/u.test(lower)) return 0;
  if (/\.doc(?:$|[?&#])/u.test(lower)) return 1;
  if (/\.pdf(?:$|[?&#])/u.test(lower)) return 2;
  if (/\b(?:download|stream|attachment|file_name|filename)\b/u.test(lower)) return 3;
  if (lower.includes("congbao.chinhphu.vn/van-ban/")) return 4;
  return 5;
}

function recursivelyCollectStrings(value: unknown, output: string[], depth = 0) {
  if (depth > 6 || output.length > 500) return;
  if (typeof value === "string") {
    if (value.trim()) output.push(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) recursivelyCollectStrings(item, output, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value as UnknownRecord)) recursivelyCollectStrings(item, output, depth + 1);
}

function looksLikeDownloadValue(value: string) {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep original.
  }
  return /\.(?:docx?|pdf)(?:$|[?&#\s])/iu.test(decoded) ||
    /\b(?:download|stream|attachment|file_name|filename)\b/iu.test(decoded);
}

function slugPart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function constructedGazetteDetailUrl(record: UnknownRecord, number: string, type: string) {
  const id = record.id_van_ban ?? record.document_id ?? record.id;
  if ((typeof id !== "number" && typeof id !== "string") || !String(id).trim()) return null;
  const prefix = `${type} số ${number}`;
  return safeOfficialUrl(`/van-ban/${slugPart(prefix)}-${String(id).trim()}.htm`, GAZETTE_ORIGINS[0]);
}

function recordSourceUrls(record: UnknownRecord, number: string, type: string) {
  const strings: string[] = [];
  recursivelyCollectStrings(record, strings);
  const urls: string[] = [];

  for (const value of strings) {
    if (!looksLikeDownloadValue(value) && !/\/van-ban\//iu.test(value)) continue;
    for (const origin of GAZETTE_ORIGINS) {
      const url = safeOfficialUrl(value, origin);
      if (url) urls.push(url);
    }
  }

  const explicitDetail = stringValue(
    record,
    "duong_dan_chi_tiet",
    "detail_url",
    "detailUrl",
    "duong_dan",
    "url",
  );
  if (explicitDetail) {
    for (const origin of GAZETTE_ORIGINS) {
      const url = safeOfficialUrl(explicitDetail, origin);
      if (url) urls.push(url);
    }
  }
  const constructed = constructedGazetteDetailUrl(record, number, type);
  if (constructed) urls.push(constructed);

  return Array.from(new Set(urls)).sort((left, right) => sourcePriority(left) - sourcePriority(right));
}

function recordToSources(record: UnknownRecord, expectedNumber: string) {
  const actual = normalizeFullNumber(stringValue(record, "so_ky_hieu", "document_number", "number"));
  if (!actual || normalizeDocumentNumber(actual) !== normalizeDocumentNumber(expectedNumber)) return [];
  const type = typeValue(record, actual);
  const issuer = issuerValue(record, actual);
  const title = titleValue(record, actual);
  const issuedDate = dateValue(record, "ngay_ban_hanh", "issued_date", "issuedDate");
  const effectiveDate = dateValue(record, "ngay_hieu_luc", "effective_date", "effectiveDate");
  const urls = recordSourceUrls(record, actual, type);
  const page = urls.find((url) => url.includes("congbao.chinhphu.vn/van-ban/")) ?? urls[0] ?? "";
  return urls.map((sourceUrl) => ({
    number: actual,
    title,
    type,
    issuer,
    issuedDate,
    effectiveDate,
    officialPageUrl: page || sourceUrl,
    sourceUrl,
    sourceLabel: "Công báo điện tử Chính phủ",
  } satisfies DurableLegalSource));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverExactGazetteSources(number: string) {
  const response = await fetchWithTimeout(GAZETTE_SEARCH_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      ...COMMON_HEADERS,
      accept: "application/json",
      "content-type": "application/json",
      origin: "https://congbao.chinhphu.vn",
      referer: "https://congbao.chinhphu.vn/",
    },
    body: JSON.stringify({ filters: {}, page: 1, page_size: 30, query: number }),
  });
  if (!response.ok) throw new Error(`API Công báo trả lỗi ${response.status}.`);
  const payload = (await response.json()) as GazettePayload;
  const seen = new Set<string>();
  return (payload.data ?? [])
    .flatMap((record) => recordToSources(record, number))
    .filter((source) => {
      if (seen.has(source.sourceUrl)) return false;
      seen.add(source.sourceUrl);
      return true;
    })
    .sort((left, right) => sourcePriority(left.sourceUrl) - sourcePriority(right.sourceUrl));
}

function exactLegacySources(number: string, sources: Awaited<ReturnType<typeof discoverOfficialSources>>["sources"]) {
  const expected = normalizeDocumentNumber(number);
  return sources
    .filter((source) => source.url && normalizeDocumentNumber(source.document_number ?? "") === expected)
    .map((source) => durableSourceFromDiscovery(number, source));
}

export async function discoverExactOfficialSources(number: string) {
  const gazette = await discoverExactGazetteSources(number).catch(() => []);
  const discovery = gazette.length ? [] : exactLegacySources(number, (await discoverOfficialSources(number)).sources);
  const seen = new Set<string>();
  return [...gazette, ...discovery]
    .filter((source) => {
      if (!source.sourceUrl || seen.has(source.sourceUrl)) return false;
      seen.add(source.sourceUrl);
      return true;
    })
    .sort((left, right) => sourcePriority(left.sourceUrl) - sourcePriority(right.sourceUrl));
}

function quotedOfficialUrls(html: string, pageUrl: string) {
  const values = [
    ...html.matchAll(/["']([^"']{1,2000})["']/gu),
    ...html.matchAll(/https:\/\/[^\s"'<>]+/giu),
  ];
  const urls: string[] = [];
  for (const match of values) {
    const raw = match[1] ?? match[0];
    if (!looksLikeDownloadValue(raw)) continue;
    const url = safeOfficialUrl(raw.replace(/\\\//g, "/"), pageUrl);
    if (url) urls.push(url);
  }
  return urls;
}

async function expandPageSources(sources: DurableLegalSource[]) {
  const expanded: DurableLegalSource[] = [];
  for (const source of sources.slice(0, 12)) {
    if (sourcePriority(source.sourceUrl) <= 3) {
      expanded.push(source);
      continue;
    }
    try {
      const fetched = await fetchDurableLegalBuffer(source.sourceUrl);
      const mime = fetched.response.headers.get("content-type")?.toLocaleLowerCase("en") ?? "";
      if (mime.includes("html")) {
        const html = fetched.buffer.toString("utf8");
        const attachments = Array.from(new Set([
          ...extractOfficialAttachmentUrls(html, fetched.url),
          ...quotedOfficialUrls(html, fetched.url),
        ])).sort((left, right) => sourcePriority(left) - sourcePriority(right));
        expanded.push(...attachments.map((sourceUrl) => ({ ...source, sourceUrl })));
      }
    } catch {
      // Keep the original source as the final fallback.
    }
    expanded.push(source);
  }
  const seen = new Set<string>();
  return expanded
    .filter((source) => {
      if (seen.has(source.sourceUrl)) return false;
      seen.add(source.sourceUrl);
      return true;
    })
    .sort((left, right) => sourcePriority(left.sourceUrl) - sourcePriority(right.sourceUrl));
}

function inferStatus(effectiveDate: string | null) {
  if (!effectiveDate) return "unknown" as const;
  return effectiveDate > new Date().toISOString().slice(0, 10) ? "upcoming" as const : "effective" as const;
}

function buildDocument(source: DurableLegalSource, extracted: DurableExtractedSource): DocumentDetail {
  const provisions = parseLegalHierarchy(extracted.officialText).map((provision, index) => ({
    id: `${slugifyDocument(source.number)}-${index}`,
    type: provision.provisionType,
    identifier: provision.identifier,
    article: provision.article,
    heading: provision.heading,
    official_text: provision.officialText,
    order_index: provision.orderIndex,
  }));
  return {
    id: slugifyDocument(`${source.number}-${source.issuer || source.sourceUrl}`),
    number: source.number,
    title: source.title,
    type: source.type,
    issuer: source.issuer || "Đang đối chiếu",
    issued_date: source.issuedDate,
    effective_date: source.effectiveDate,
    status: inferStatus(source.effectiveDate),
    source_url: source.officialPageUrl || source.sourceUrl,
    source_label: source.sourceLabel,
    last_verified_at: new Date().toISOString(),
    extraction_method: extracted.extractionMethod,
    quality_score: extracted.qualityScore,
    verification_notes: `Toàn văn được đọc từ ${extracted.fileName || "tệp đính kèm chính thức"}.`,
    official_text: extracted.officialText,
    provisions,
  };
}

async function resolveExactOfficialDocumentUncached(number: string): Promise<ExactResolution> {
  const warnings: string[] = [];
  const initial = await discoverExactOfficialSources(number);
  const sources = await expandPageSources(initial);
  let queueSource: DurableLegalSource | null = sources[0] ?? null;

  for (const source of sources.slice(0, 12)) {
    try {
      const extracted = await extractDurableLegalSource(source.sourceUrl);
      if (extracted.requiresOcr) {
        queueSource = source;
        warnings.push(`${source.number}: tệp chính thức là PDF scan cần OCR nền.`);
        continue;
      }
      if (looksLikeGovernmentPortalShell(extracted.officialText)) {
        warnings.push(`${source.number}: nguồn ${new URL(source.sourceUrl).hostname} chỉ trả phần khung trang.`);
        continue;
      }
      const validation = validateDurableLegalText({
        expectedNumber: source.number,
        issuedDate: source.issuedDate,
        text: extracted.officialText,
        extractionMethod: extracted.extractionMethod,
        qualityScore: extracted.qualityScore,
        totalPages: 0,
      });
      if (!validation.accepted || !hasUsableLegalDocumentText(extracted.officialText, source.number)) {
        warnings.push(...validation.warnings.map((warning) => `${source.number}: ${warning}`));
        continue;
      }
      return { document: buildDocument(source, extracted), source, warnings };
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "Không đọc được một nguồn chính thức.");
    }
  }
  return { document: null, source: queueSource, warnings: Array.from(new Set(warnings)) };
}

const cachedExactDocument = unstable_cache(
  resolveExactOfficialDocumentUncached,
  ["thue-ro-exact-official-document-v2"],
  { revalidate: DOCUMENT_REVALIDATE_SECONDS, tags: ["official-legal-documents"] },
);

function incrementalCacheUnavailable(error: unknown) {
  return error instanceof Error && /incrementalcache\s+missing/iu.test(error.message);
}

export async function resolveExactOfficialDocument(number: string) {
  try {
    return await cachedExactDocument(normalizeFullNumber(number));
  } catch (error) {
    if (!incrementalCacheUnavailable(error)) throw error;
    return resolveExactOfficialDocumentUncached(normalizeFullNumber(number));
  }
}

export async function loadExactOfficialDocument(number: string) {
  return (await resolveExactOfficialDocument(number)).document;
}

async function claimSearchIngestion(number: string) {
  const { put } = await import("@vercel/blob");
  const hour = new Date().toISOString().slice(0, 13);
  const pathname = `legal-documents/${documentStorageKey(number)}/runs/search-claims/${hour}.json`;
  try {
    await put(pathname, JSON.stringify({ number, claimedAt: new Date().toISOString() }), {
      access: durableStoreAccess(),
      allowOverwrite: false,
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
      contentType: "application/json; charset=utf-8",
    });
    return true;
  } catch {
    return false;
  }
}

async function queueExactIngestion(source: DurableLegalSource): Promise<QueueResult> {
  if (!durableStoreConfigured()) return { status: "unavailable", state: null };
  const revision = await readDurableRevision(source.number).catch(() => null);
  if (revision?.validation.accepted) return { status: "cooldown", state: null };
  const current = await readDurableIngestionState(source.number).catch(() => null);
  if (!shouldQueueExactIngestion(current)) {
    return { status: current?.status === "processing" ? "processing" : "cooldown", state: current };
  }
  if (!(await claimSearchIngestion(source.number))) return { status: "processing", state: current };

  const jobId = randomUUID();
  const queued: DurableIngestionState = {
    number: source.number,
    status: "processing",
    stage: "queued",
    runId: jobId,
    sourceUrl: source.sourceUrl,
    extractionMethod: null,
    processedPages: 0,
    totalPages: 0,
    qualityScore: null,
    warnings: [],
    error: null,
    updatedAt: new Date().toISOString(),
  };
  await writeDurableIngestionState(queued);
  try {
    const [{ start }, { legalDocumentIngestionWorkflow }] = await Promise.all([
      import("workflow/api"),
      import("../../workflows/legal-document-ingestion.ts"),
    ]);
    await start(legalDocumentIngestionWorkflow, [{ jobId, source, persist: true }]);
    return { status: "started", state: queued };
  } catch (error) {
    const failed: DurableIngestionState = {
      ...queued,
      status: "failed",
      stage: "completed",
      error: error instanceof Error ? error.message : "Không khởi động được pipeline nhập nền.",
      updatedAt: new Date().toISOString(),
    };
    await writeDurableIngestionState(failed).catch(() => undefined);
    return { status: "failed", state: failed };
  }
}

function candidate(source: DurableLegalSource): SearchCandidate {
  return {
    id: `exact-${slugifyDocument(source.number)}`,
    number: source.number,
    title: source.title,
    type: source.type,
    issuer: source.issuer || "Chưa xác định cơ quan ban hành",
    issued_date: source.issuedDate,
    source_url: source.officialPageUrl || source.sourceUrl,
    source_label: source.sourceLabel,
  };
}

function queueMessage(number: string, queue: QueueResult) {
  if (queue.status === "started") {
    return `Đã xác định đúng ${number} và đã đưa tệp chính thức vào pipeline nhập toàn văn. Hệ thống đang xử lý nền; khi hoàn tất và đạt kiểm tra chất lượng, lần tra cứu tiếp theo sẽ tự mở toàn văn.`;
  }
  if (queue.status === "processing") {
    return `Đã xác định đúng ${number}. Toàn văn đang được hệ thống xử lý nền và chỉ được công bố sau khi đủ nội dung, đúng số hiệu và vượt kiểm tra chất lượng.`;
  }
  if (queue.status === "cooldown") {
    return `Đã xác định đúng ${number}. Lượt nhập gần nhất đã được ghi nhận; hệ thống không khởi động trùng nhiều công việc và sẽ tự thử lại theo chính sách an toàn.`;
  }
  if (queue.status === "failed") {
    return `Đã xác định đúng ${number}, nhưng chưa khởi động được lượt nhập nền mới. Liên kết nguồn chính thức vẫn được giữ để đối chiếu và hệ thống sẽ cho phép thử lại sau thời gian chờ.`;
  }
  return `Đã xác định đúng ${number}, nhưng toàn văn chưa đọc được trực tiếp và kho nhập nền chưa sẵn sàng. Hệ thống giữ liên kết nguồn chính thức thay vì hiển thị phần khung trang như nội dung pháp luật.`;
}

export async function exactOfficialDocumentResponse(query: string): Promise<TaxSearchResponse | null> {
  const number = canonicalExactDocumentNumber(query);
  if (!number) return null;
  const resolved = await resolveExactOfficialDocument(number).catch((error) => ({
    document: null,
    source: null,
    warnings: [error instanceof Error ? error.message : "Không thể mở nguồn chính thức."],
  }));
  const retrievedAt = new Date().toISOString();

  if (resolved.document) {
    return {
      query_normalized: normalizeLegalQuery(query),
      query_kind: "document",
      direct_answer: `Đã tìm thấy ${resolved.document.number}: ${resolved.document.title}.`,
      document: resolved.document,
      candidates: [],
      warnings: Array.from(new Set(resolved.warnings)).slice(0, 5),
      confidence: 0.99,
      retrieved_at: retrievedAt,
    };
  }

  if (!resolved.source) return null;
  const queue = await queueExactIngestion(resolved.source).catch(() => ({ status: "failed" as const, state: null }));
  return {
    query_normalized: normalizeLegalQuery(query),
    query_kind: "document",
    direct_answer: queueMessage(number, queue),
    document: null,
    candidates: [candidate(resolved.source)],
    warnings: Array.from(new Set(resolved.warnings)).slice(0, 5),
    confidence: queue.status === "started" || queue.status === "processing" ? 0.9 : 0.72,
    retrieved_at: retrievedAt,
  };
}
