import { extractExactLegalNumber } from "./durable-document-lookup-core.ts";
import {
  normalizeDocumentNumber,
  type DurableIngestionState,
  type DurableLegalSource,
} from "./durable-ingestion-types.ts";
import { extractSearchHint, normalizeLegalQuery } from "./query.ts";

const GAZETTE_ORIGINS = [
  "https://congbao.chinhphu.vn",
  "https://api-searchcongbao.chinhphu.vn",
] as const;
const RETRY_COOLDOWN_MS = 12 * 60 * 60 * 1_000;
const ALLOWED_ROOT_DOMAINS = ["chinhphu.vn", "mof.gov.vn", "gdt.gov.vn", "moj.gov.vn", "vbpl.vn"];

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

function isAllowedLegalSource(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLocaleLowerCase("en");
    return url.protocol === "https:" && ALLOWED_ROOT_DOMAINS.some((root) => host === root || host.endsWith(`.${root}`));
  } catch {
    return false;
  }
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
  return joined.match(/\b(docx|doc|pdf)\b/u)?.[1] ?? "";
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
  return Array.from(
    new Set(
      GAZETTE_ORIGINS
        .map((origin) => safeOfficialUrl(raw, origin))
        .filter((value): value is string => Boolean(value)),
    ),
  );
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
  const ranked: Array<{ source: DurableLegalSource; priority: number }> = [];

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
        ranked.push({
          priority: sourcePriority(sourceUrl, extension),
          source: {
            number: actual,
            title,
            type,
            issuer,
            issuedDate,
            effectiveDate,
            officialPageUrl: officialPageUrl(document, sourceUrl),
            sourceUrl,
            sourceLabel: "Công báo điện tử Chính phủ",
          },
        });
      }
    }
  }

  const seen = new Set<string>();
  return ranked
    .sort((left, right) => left.priority - right.priority)
    .map(({ source }) => source)
    .filter((source) => {
      if (seen.has(source.sourceUrl)) return false;
      seen.add(source.sourceUrl);
      return true;
    });
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

export function shouldQueueExactIngestion(state: DurableIngestionState | null, nowMs = Date.now()) {
  if (!state) return true;
  if (state.status === "processing" || state.status === "ready") return false;
  const updatedAt = Date.parse(state.updatedAt);
  return !Number.isFinite(updatedAt) || nowMs - updatedAt >= RETRY_COOLDOWN_MS;
}
