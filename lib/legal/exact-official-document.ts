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
import { extractExactLegalNumber } from "./durable-document-lookup-core.ts";
import { isAllowedLegalSource, parseLegalHierarchy, slugifyDocument } from "./ingestion.ts";
import { extractSearchHint, normalizeLegalQuery } from "./query.ts";
import { durableSourceFromDiscovery } from "./recent-tax-discovery-core.ts";
import type { DocumentDetail, SearchCandidate, TaxSearchResponse } from "./types.ts";

const GAZETTE_SEARCH_URL = "https://api-searchcongbao.chinhphu.vn/search/van-ban";
const GAZETTE_ORIGINS = [
  "https://congbao.chinhphu.vn",
  "https://api-searchcongbao.chinhphu.vn",
] as const;
const DOCUMENT_REVALIDATE_SECONDS = 7 * 24 * 60 * 60;
const RETRY_COOLDOWN_MS = 12 * 60 * 60 * 1_000;
const COMMON_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
  "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
};

type GazetteAttachment = {
  duong_dan?: string;
  file_extension?: string;
  file_name?: string;
  ten_tep?: string;
};

type GazetteDocument = {
  id_van_ban?: number;
  so_ky_hieu?: string;
  tieu_de?: string;
  loai_van_ban?: string;
  trich_yeu?: string;
  ngay_ban_hanh?: string;
  ngay_hieu_luc?: string;
  ten_co_quan?: string[] | string;
  duong_dan?: string;
  duong_dan_chi_tiet?: string;
  url?: string;
  danh_sach_tep_van_ban?: GazetteAttachment[];
};

type GazettePayload = {
  success?: boolean;
  data?: GazetteDocument[];
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

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLocaleLowerCase("en")] ?? `&${entity};`;
  });
}

function normalizeFullNumber(value: string) {
  return value
    .replace(/ND-CP/giu, "NĐ-CP")
    .replace(/QD-/giu, "QĐ-")
    .replace(/\s+/g, "")
    .toLocaleUpperCase("vi");
}

export function canonicalExactDocumentNumber(query: string) {
  const repaired = query.replace(/ND-CP/giu, "NĐ-CP").replace(/QD-/giu, "QĐ-");
  const exact = extractExactLegalNumber(repaired);
  if (exact) return normalizeFullNumber(exact);

  const hint = extractSearchHint(query);
  if (!hint.number || !hint.year || !hint.type) return null;
  const normalized = normalizeLegalQuery(query);
  const type = normalizeLegalQuery(hint.type);

  if (type === "nghi dinh") return `${hint.number}/${hint.year}/NĐ-CP`;
  if (type === "thong tu" && /\b(?:bo tai chinh|btc|tt-btc)\b/.test(normalized)) {
    return `${hint.number}/${hint.year}/TT-BTC`;
  }
  if (type === "nghi quyet" && /\bchinh phu\b/.test(normalized)) {
    return `${hint.number}/${hint.year}/NQ-CP`;
  }
  if (type === "quyet dinh" && /\b(?:thu tuong|ttg)\b/.test(normalized)) {
    return `${hint.number}/${hint.year}/QĐ-TTg`;
  }
  return null;
}

function isoDate(value: string | null | undefined) {
  const clean = value?.trim() ?? "";
  if (!clean) return null;
  if (/^20\d{2}-\d{2}-\d{2}$/.test(clean)) return clean;
  const match = clean.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (!match) return null;
  return `${match[3]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[1])).padStart(2, "0")}`;
}

function inferType(number: string, stated?: string) {
  if (stated?.trim()) return stated.trim();
  if (/\/NĐ-CP$/iu.test(number)) return "Nghị định";
  if (/\/TT-/iu.test(number)) return "Thông tư";
  if (/\/NQ-/iu.test(number)) return "Nghị quyết";
  if (/\/QĐ-/iu.test(number)) return "Quyết định";
  if (/\/(?:QH|UBTVQH)\d*$/iu.test(number)) return "Luật/Nghị quyết";
  return "Văn bản pháp luật";
}

function inferIssuer(number: string, value: GazetteDocument) {
  const stated = Array.isArray(value.ten_co_quan)
    ? value.ten_co_quan.filter(Boolean).join(", ")
    : value.ten_co_quan?.trim() ?? "";
  if (stated) return stated;
  if (/TT-BTC$/iu.test(number)) return "Bộ Tài chính";
  if (/NĐ-CP$/iu.test(number) || /NQ-CP$/iu.test(number)) return "Chính phủ";
  if (/QĐ-TTg$/iu.test(number)) return "Thủ tướng Chính phủ";
  if (/\/(?:QH|UBTVQH)\d*$/iu.test(number)) return "Quốc hội";
  return "";
}

function safeOfficialUrl(rawValue: string, base: string) {
  const raw = decodeHtml(rawValue.trim());
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

function extensionSignal(...values: Array<string | null | undefined>) {
  const joined = values
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    })
    .join(" ")
    .toLocaleLowerCase("en");
  const match = joined.match(/\.(docx|doc|pdf)(?:$|[?&#\s])/u);
  if (match) return match[1];
  const plain = joined.match(/\b(docx|doc|pdf)\b/u);
  return plain?.[1] ?? "";
}

function sourcePriority(url: string, extension = "") {
  const signal = extension || extensionSignal(url);
  if (signal === "docx") return 0;
  if (signal === "doc") return 1;
  if (signal === "pdf") return 2;
  if (/\b(?:download|stream|attachment)\b/iu.test(url)) return 3;
  return 4;
}

function attachmentUrlCandidates(attachment: GazetteAttachment) {
  const raw = attachment.duong_dan?.trim() ?? "";
  if (!raw) return [];
  const urls = GAZETTE_ORIGINS.map((origin) => safeOfficialUrl(raw, origin)).filter(
    (value): value is string => Boolean(value),
  );
  const exact = safeOfficialUrl(raw, GAZETTE_ORIGINS[0]);
  if (exact) urls.unshift(exact);
  return Array.from(new Set(urls));
}

function officialPageUrl(document: GazetteDocument, fallback: string) {
  const raw = document.duong_dan_chi_tiet || document.duong_dan || document.url || "";
  for (const origin of GAZETTE_ORIGINS) {
    const resolved = safeOfficialUrl(raw, origin);
    if (resolved) return resolved;
  }
  return fallback;
}

export function parseExactGazettePayload(number: string, payload: GazettePayload) {
  const expected = normalizeDocumentNumber(number);
  const sources: DurableLegalSource[] = [];

  for (const document of payload.data ?? []) {
    const actual = normalizeFullNumber(document.so_ky_hieu?.trim() ?? "");
    if (!actual || normalizeDocumentNumber(actual) !== expected) continue;
    const title = document.trich_yeu?.trim() || document.tieu_de?.trim() || `Văn bản số ${actual}`;
    const type = inferType(actual, document.loai_van_ban);
    const issuer = inferIssuer(actual, document);
    const issuedDate = isoDate(document.ngay_ban_hanh);
    const effectiveDate = isoDate(document.ngay_hieu_luc);

    for (const attachment of document.danh_sach_tep_van_ban ?? []) {
      const extension = extensionSignal(
        attachment.file_extension,
        attachment.file_name,
        attachment.ten_tep,
        attachment.duong_dan,
      );
      for (const sourceUrl of attachmentUrlCandidates(attachment)) {
        sources.push({
          number: actual,
          title,
          type,
          issuer,
          issuedDate,
          effectiveDate,
          officialPageUrl: officialPageUrl(document, sourceUrl),
          sourceUrl,
          sourceLabel: "Công báo điện tử Chính phủ",
        });
        Object.defineProperty(sources[sources.length - 1], "__priority", {
          value: sourcePriority(sourceUrl, extension),
          enumerable: false,
        });
      }
    }
  }

  const seen = new Set<string>();
  return sources
    .filter((source) => {
      if (seen.has(source.sourceUrl)) return false;
      seen.add(source.sourceUrl);
      return true;
    })
    .sort((left, right) => {
      const leftPriority = Number((left as DurableLegalSource & { __priority?: number }).__priority ?? sourcePriority(left.sourceUrl));
      const rightPriority = Number((right as DurableLegalSource & { __priority?: number }).__priority ?? sourcePriority(right.sourceUrl));
      return leftPriority - rightPriority;
    });
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
  const response = await fetchWithTimeout(
    GAZETTE_SEARCH_URL,
    {
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
    },
  );
  if (!response.ok) throw new Error(`API Công báo trả lỗi ${response.status}.`);
  return parseExactGazettePayload(number, (await response.json()) as GazettePayload);
}

function exactLegacySources(number: string, sources: Awaited<ReturnType<typeof discoverOfficialSources>>["sources"]) {
  const expected = normalizeDocumentNumber(number);
  return sources
    .filter((source) => source.url && normalizeDocumentNumber(source.document_number ?? "") === expected)
    .map((source) => durableSourceFromDiscovery(number, source));
}

export async function discoverExactOfficialSources(number: string) {
  const gazette = await discoverExactGazetteSources(number).catch(() => []);
  if (gazette.length) return gazette;
  const discovery = await discoverOfficialSources(number);
  return exactLegacySources(number, discovery.sources);
}

function attr(tag: string, name: string) {
  return decodeHtml(tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "iu"))?.[1] ?? "");
}

function looksLikeAttachmentLink(tag: string, raw: string) {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Keep the undecoded value.
  }
  const value = `${tag} ${decoded}`.toLocaleLowerCase("en");
  return (
    /\.(?:pdf|docx?)(?:$|[?&#"'\s])/u.test(value) ||
    /\b(?:file_name|filename|download|attachment|stream|tai-ve|tai-xuong)\b/u.test(value) ||
    /\bdownload\b/iu.test(tag)
  );
}

export function extractOfficialAttachmentUrls(html: string, pageUrl: string) {
  const urls: string[] = [];
  for (const match of html.matchAll(/<(?:a|iframe|embed|object|source)\b[^>]*>/giu)) {
    const tag = match[0];
    const raw = attr(tag, "href") || attr(tag, "src") || attr(tag, "data");
    if (!raw || !looksLikeAttachmentLink(tag, raw)) continue;
    const resolved = safeOfficialUrl(raw, pageUrl);
    if (resolved) urls.push(resolved);
  }
  return Array.from(new Set(urls)).sort((left, right) => sourcePriority(left) - sourcePriority(right));
}

async function expandPageSources(sources: DurableLegalSource[]) {
  const expanded: DurableLegalSource[] = [];
  for (const source of sources) {
    if (sourcePriority(source.sourceUrl) <= 3) {
      expanded.push(source);
      continue;
    }
    try {
      const fetched = await fetchDurableLegalBuffer(source.sourceUrl);
      const mime = fetched.response.headers.get("content-type")?.toLocaleLowerCase("en") ?? "";
      if (mime.includes("html")) {
        const attachments = extractOfficialAttachmentUrls(fetched.buffer.toString("utf8"), fetched.url);
        expanded.push(...attachments.map((sourceUrl) => ({ ...source, sourceUrl })));
      }
    } catch {
      // Keep the original page source as the final fallback.
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

  for (const source of sources.slice(0, 10)) {
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
  ["thue-ro-exact-official-document-v1"],
  { revalidate: DOCUMENT_REVALIDATE_SECONDS, tags: ["official-legal-documents"] },
);

function incrementalCacheUnavailable(error: unknown) {
  return error instanceof Error && /incrementalcache\s+missing/iu.test(error.message);
}

export async function resolveExactOfficialDocument(number: string) {
  try {
    return await cachedExactDocument(number);
  } catch (error) {
    if (!incrementalCacheUnavailable(error)) throw error;
    return resolveExactOfficialDocumentUncached(number);
  }
}

export async function loadExactOfficialDocument(number: string) {
  return (await resolveExactOfficialDocument(normalizeFullNumber(number))).document;
}

export function shouldQueueExactIngestion(state: DurableIngestionState | null, nowMs = Date.now()) {
  if (!state) return true;
  if (state.status === "processing" || state.status === "ready") return false;
  const updatedAt = Date.parse(state.updatedAt);
  return !Number.isFinite(updatedAt) || nowMs - updatedAt >= RETRY_COOLDOWN_MS;
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
  if (!(await claimSearchIngestion(source.number))) {
    return { status: "processing", state: current };
  }

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
    if (resolved.source) await queueExactIngestion(resolved.source).catch(() => undefined);
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
