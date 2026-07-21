import { createHash } from "node:crypto";
import { extractSearchHint, normalizeLegalQuery } from "./query";
import type { OnlineLegalSource } from "./types";

export type OfficialSourceDiscovery = {
  draft_answer: string;
  sources: OnlineLegalSource[];
};

type GazetteAttachment = {
  duong_dan?: string;
  file_extension?: string;
};

type GazetteDocument = {
  id_van_ban?: number;
  so_ky_hieu?: string;
  tieu_de?: string;
  loai_van_ban?: string;
  trich_yeu?: string;
  ngay_ban_hanh?: string;
  ten_co_quan?: string[];
  score?: number;
  noi_dung_lien_quan_tim_thay?: string;
  danh_sach_tep_van_ban?: GazetteAttachment[];
};

type GazetteSearchPayload = {
  success?: boolean;
  data?: GazetteDocument[];
};

const GAZETTE_SEARCH_URL = "https://api-searchcongbao.chinhphu.vn/search/van-ban";
const GOVERNMENT_SEARCH_URL = "https://vanban.chinhphu.vn/he-thong-van-ban?classid=1&mode=1";
const COMMON_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
  "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
};
const FULL_DOCUMENT_NUMBER =
  /\b\d{1,4}\s*\/\s*20\d{2}\s*\/\s*(?:NĐ-CP|ND-CP|TT-[A-ZĐ0-9-]+|NQ-[A-ZĐ0-9-]+|QĐ-[A-ZĐa-z0-9-]+|QD-[A-Za-z0-9-]+|QH\d*|UBTVQH\d*)\b/iu;

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

function attribute(tag: string, name: string) {
  return decodeHtml(tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "iu"))?.[1] ?? "");
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/\s+/g, "");
}

function documentNumberHint(query: string) {
  return (query.match(FULL_DOCUMENT_NUMBER)?.[0] ?? query)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function hiddenFormFields(html: string) {
  const params = new URLSearchParams();
  for (const match of html.matchAll(/<input\b[^>]*>/giu)) {
    const tag = match[0];
    const name = attribute(tag, "name");
    const type = attribute(tag, "type").toLocaleLowerCase("en");
    if (name && type === "hidden") params.set(name, attribute(tag, "value"));
  }
  return params;
}

function cookieHeader(headers: Headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const source = values.length ? values : headers.get("set-cookie") ? [headers.get("set-cookie") as string] : [];
  return source.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 18_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function preferredGazetteAttachment(attachments: GazetteAttachment[]) {
  const valid = attachments.filter((attachment) => {
    try {
      const url = new URL(attachment.duong_dan ?? "");
      return url.protocol === "https:" && url.hostname.endsWith("chinhphu.vn");
    } catch {
      return false;
    }
  });
  const extension = (attachment: GazetteAttachment) =>
    (attachment.file_extension || attachment.duong_dan?.match(/\.([a-z0-9]+)(?:\?|$)/iu)?.[1] || "").toLocaleLowerCase("en");
  return (
    valid.find((attachment) => extension(attachment) === "docx") ??
    valid.find((attachment) => extension(attachment) === "doc") ??
    valid.find((attachment) => extension(attachment) === "pdf") ??
    valid[0] ??
    null
  );
}

async function searchGazetteDocuments(query: string): Promise<OnlineLegalSource[]> {
  const hint = documentNumberHint(query);
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
      body: JSON.stringify({ filters: {}, page: 1, page_size: 30, query: hint }),
    },
    20_000,
  );
  if (!response.ok) throw new Error(`API Công báo trả lỗi ${response.status}.`);
  const payload = (await response.json()) as GazetteSearchPayload;
  const normalizedHint = normalize(hint);

  return (payload.data ?? [])
    .map((document) => {
      const attachment = preferredGazetteAttachment(document.danh_sach_tep_van_ban ?? []);
      const url = attachment?.duong_dan?.trim() ?? "";
      const number = document.so_ky_hieu?.trim() || document.tieu_de?.trim() || "Văn bản";
      const normalizedNumber = normalize(number);
      const exact = normalizedHint.length >= 4 && normalizedNumber === normalizedHint;
      const related = normalizedHint.length >= 4 && normalizedNumber.includes(normalizedHint);
      const type = document.loai_van_ban?.trim() || "Văn bản pháp luật";
      const title = [`${type} số ${number}`, document.trich_yeu].filter(Boolean).join(": ");
      const issuer = document.ten_co_quan?.filter(Boolean).join(", ") ?? "";
      const issuedDate = document.ngay_ban_hanh?.slice(0, 10) || null;
      const snippet = [
        document.trich_yeu,
        issuer ? `Cơ quan ban hành: ${issuer}.` : "",
        issuedDate ? `Ngày ban hành: ${issuedDate}.` : "",
        document.noi_dung_lien_quan_tim_thay,
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 2_000);
      const baseScore = Number.isFinite(document.score) ? Number(document.score) : 0;
      return {
        id: `gazette-${document.id_van_ban ?? createHash("sha256").update(`${number}-${url}`).digest("hex").slice(0, 16)}`,
        title,
        url,
        snippet,
        score: exact ? 5.2 : related ? 3.4 : 1.4 + Math.min(1, Math.max(0, baseScore)),
        source_label: "Công báo điện tử Chính phủ",
        previewable: true,
        document_number: number,
        document_type: type,
        issuer,
        issued_date: issuedDate,
      } satisfies OnlineLegalSource;
    })
    .filter((source) => source.url)
    .sort((left, right) => right.score - left.score)
    .slice(0, 30);
}

export function currentBackboneQueries(query: string) {
  const normalized = normalizeLegalQuery(query);
  const queries: string[] = [];

  if (/\b(?:dang ky thue|ma so thue|thay doi thong tin|chuyen dia chi|khoi phuc ma so|cham dut ma so)\b/.test(normalized)) {
    queries.push("90/2026/TT-BTC", "108/2025/QH15");
  }

  if (/\b(?:ho kinh doanh|ca nhan kinh doanh|cho thue nha|cho thue bat dong san|doanh thu)\b/.test(normalized)) {
    queries.push("141/2026/NĐ-CP", "50/2026/TT-BTC", "18/2026/TT-BTC");
  }

  if (/\b(?:hoa don|may tinh tien|dat coc|chu ky so|nguoi mua|lap hoa don|giao hoa don)\b/.test(normalized)) {
    queries.push("254/2026/NĐ-CP", "91/2026/TT-BTC");
  }

  if (/\b(?:quan ly thue|tam hoan xuat canh|no thue|cuong che|khai thue|nop thue|thoi han)\b/.test(normalized)) {
    queries.push("108/2025/QH15", "252/2026/NĐ-CP", "89/2026/TT-BTC");
  }

  if (/\b(?:thu nhap doanh nghiep|tndn|tam nop|doanh nghiep moi thanh lap)\b/.test(normalized)) {
    queries.push("141/2026/NĐ-CP", "320/2025/NĐ-CP");
  }

  return Array.from(new Set(queries)).slice(0, 4);
}

export function questionSearchQueries(query: string) {
  const hint = extractSearchHint(query);
  if (!hint.asksQuestion) return [query];

  const currentYear = new Date().getFullYear();
  const normalized = normalizeLegalQuery(query);
  const topical: string[] = [];

  if (/\b(?:ho kinh doanh|ca nhan kinh doanh)\b/.test(normalized)) {
    topical.push(`chính sách thuế hộ kinh doanh cá nhân kinh doanh ${currentYear}`);
  } else if (/\b(?:hoa don|may tinh tien)\b/.test(normalized)) {
    topical.push(`quản lý thuế hóa đơn điện tử ${currentYear}`);
  } else if (/\b(?:thu nhap ca nhan|quyet toan|tncn)\b/.test(normalized)) {
    topical.push(`thuế thu nhập cá nhân quyết toán ${currentYear}`);
  } else if (/\b(?:gia tri gia tang|gtgt)\b/.test(normalized)) {
    topical.push(`thuế giá trị gia tăng ${currentYear} sửa đổi bổ sung`);
  } else if (/\b(?:thu nhap doanh nghiep|tndn)\b/.test(normalized)) {
    topical.push(`thuế thu nhập doanh nghiệp ${currentYear} sửa đổi bổ sung`);
  }

  return Array.from(
    new Set([
      ...currentBackboneQueries(query),
      query,
      `${query} ${currentYear} sửa đổi bổ sung thay thế`,
      ...topical,
    ]),
  ).slice(0, 7);
}

function mergeSources(groups: OnlineLegalSource[][]) {
  const byKey = new Map<string, OnlineLegalSource>();
  for (const source of groups.flat()) {
    const key = source.document_number ? `number:${normalize(source.document_number)}` : `url:${source.url}`;
    const existing = byKey.get(key);
    if (!existing || source.score > existing.score) byKey.set(key, source);
  }
  return [...byKey.values()].sort((left, right) => right.score - left.score);
}

function inferDocumentType(number: string, value: string) {
  const normalized = normalizeLegalQuery(`${number} ${value}`);
  if (normalized.includes("nd-cp") || normalized.includes("nghi dinh")) return "Nghị định";
  if (normalized.includes("tt-") || normalized.includes("thong tu")) return "Thông tư";
  if (normalized.includes("qh") || normalized.includes("luat")) return "Luật";
  if (normalized.includes("nq-") || normalized.includes("nghi quyet")) return "Nghị quyết";
  if (normalized.includes("qd-") || normalized.includes("quyet dinh")) return "Quyết định";
  return "Văn bản pháp luật";
}

function inferIssuer(number: string, value: string) {
  const normalized = normalizeLegalQuery(`${number} ${value}`);
  if (normalized.includes("tt-btc") || normalized.includes("bo tai chinh")) return "Bộ Tài chính";
  if (normalized.includes("nd-cp") || normalized.includes("chinh phu")) return "Chính phủ";
  if (/\bqh\d*\b/.test(normalized) || normalized.includes("quoc hoi")) return "Quốc hội";
  return "";
}

function inferIssuedDate(value: string) {
  const match = value.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (!match) return null;
  return `${match[3]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[1])).padStart(2, "0")}`;
}

function parseGovernmentResults(html: string, hint: string): OnlineLegalSource[] {
  const rows: OnlineLegalSource[] = [];
  const normalizedHint = normalize(hint);

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*(?:docid|docId)=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/giu)) {
    const rawHref = decodeHtml(match[1]);
    let url: string;
    try {
      url = new URL(rawHref, GOVERNMENT_SEARCH_URL).toString();
    } catch {
      continue;
    }
    if (!new URL(url).hostname.endsWith("chinhphu.vn") || rows.some((row) => row.url === url)) continue;

    const title = stripTags(match[2]);
    if (!title) continue;
    const start = Math.max(0, (match.index ?? 0) - 450);
    const end = Math.min(html.length, (match.index ?? 0) + match[0].length + 1_100);
    const snippet = stripTags(html.slice(start, end)).slice(0, 1_400);
    const combined = `${title} ${snippet}`;
    const number = combined.match(FULL_DOCUMENT_NUMBER)?.[0]?.replace(/\s+/g, "") ?? "";
    const normalizedNumber = normalize(number);
    const exact = Boolean(number && normalizedNumber === normalizedHint);
    const related = Boolean(
      normalizedHint.length >= 4 &&
        (normalize(title).includes(normalizedHint) || normalize(snippet).includes(normalizedHint)),
    );
    const type = inferDocumentType(number, combined);
    rows.push({
      id: `government-${createHash("sha256").update(url).digest("hex").slice(0, 20)}`,
      title,
      url,
      snippet: snippet || "Kết quả từ Hệ thống văn bản Chính phủ.",
      score: exact ? 4.8 : related ? 1.8 : 0.65,
      source_label: "Hệ thống văn bản Chính phủ",
      previewable: true,
      document_number: number || undefined,
      document_type: type,
      issuer: inferIssuer(number, combined) || undefined,
      issued_date: inferIssuedDate(combined),
    });
  }

  return rows.sort((left, right) => right.score - left.score).slice(0, 18);
}

async function searchGovernmentDocuments(query: string) {
  const initial = await fetchWithTimeout(GOVERNMENT_SEARCH_URL, { cache: "no-store", headers: COMMON_HEADERS });
  if (!initial.ok) throw new Error(`Hệ thống văn bản Chính phủ trả lỗi ${initial.status}.`);

  const initialHtml = await initial.text();
  const body = hiddenFormFields(initialHtml);
  const hint = documentNumberHint(query);
  body.set("ctrl_191017_163$txtSearchKeyword", hint);
  body.set("ctrl_191017_163$btnSearch", "Tìm kiếm");
  body.set("ctrl_191017_163$hidIsSearch", "1");
  body.delete("__EVENTTARGET");
  body.delete("__EVENTARGUMENT");

  const cookie = cookieHeader(initial.headers);
  const searched = await fetchWithTimeout(GOVERNMENT_SEARCH_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      ...COMMON_HEADERS,
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://vanban.chinhphu.vn",
      referer: GOVERNMENT_SEARCH_URL,
      ...(cookie ? { cookie } : {}),
    },
    body: body.toString(),
  });
  if (!searched.ok) throw new Error(`Hệ thống văn bản Chính phủ trả lỗi ${searched.status}.`);
  return parseGovernmentResults(await searched.text(), hint);
}

export async function discoverOfficialSources(query: string): Promise<OfficialSourceDiscovery> {
  const queries = questionSearchQueries(query);
  const exactQueries = queries.filter((item) => FULL_DOCUMENT_NUMBER.test(item)).slice(0, 4);
  const governmentQueries = exactQueries.length ? exactQueries : [query];

  const [gazetteSettled, governmentSettled] = await Promise.all([
    Promise.allSettled(queries.map((item) => searchGazetteDocuments(item))),
    Promise.allSettled(governmentQueries.map((item) => searchGovernmentDocuments(item))),
  ]);

  const groups = [...gazetteSettled, ...governmentSettled]
    .filter((result): result is PromiseFulfilledResult<OnlineLegalSource[]> => result.status === "fulfilled")
    .map((result) => result.value);
  const sources = mergeSources(groups).slice(0, 40);
  if (sources.length) {
    return {
      draft_answer:
        "Đã đối chiếu đồng thời Công báo điện tử Chính phủ và Hệ thống văn bản Chính phủ, ưu tiên các văn bản trục hiện hành đúng nhóm nghiệp vụ.",
      sources,
    };
  }

  const messages = [...gazetteSettled, ...governmentSettled]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => (result.reason instanceof Error ? result.reason.message : ""))
    .filter(Boolean);
  if (messages.length) throw new Error(Array.from(new Set(messages)).join(" "));
  throw new Error("Không tìm thấy văn bản khớp trên các nguồn pháp luật chính thức. Hãy kiểm tra lại số hiệu, năm và cơ quan ban hành.");
}
