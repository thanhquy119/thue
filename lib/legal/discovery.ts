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
  return (
    query.match(
      /\b\d{1,4}\s*\/\s*20\d{2}\s*\/\s*(?:NĐ-CP|ND-CP|TT-[A-ZĐ0-9-]+|NQ-[A-ZĐ0-9-]+|QĐ-[A-ZĐa-z0-9-]+|QD-[A-Za-z0-9-]+|QH\d*|UBTVQH\d*)\b/iu,
    )?.[0] ?? query
  )
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
        score: exact ? 4.5 : related ? 3.2 : 1.4 + Math.min(1, Math.max(0, baseScore)),
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

function questionSearchQueries(query: string) {
  const hint = extractSearchHint(query);
  if (!hint.asksQuestion) return [query];

  const currentYear = new Date().getFullYear();
  const normalized = normalizeLegalQuery(query);
  const queries = [query, `${query} ${currentYear} sửa đổi bổ sung`];

  if (/\b(?:ho kinh doanh|ca nhan kinh doanh)\b/.test(normalized)) {
    queries.push(`chính sách thuế hộ kinh doanh cá nhân kinh doanh ${currentYear}`);
  } else if (/\b(?:hoa don|may tinh tien)\b/.test(normalized)) {
    queries.push(`quản lý thuế hóa đơn điện tử ${currentYear}`);
  } else if (/\b(?:thu nhap ca nhan|quyet toan|tncn)\b/.test(normalized)) {
    queries.push(`thuế thu nhập cá nhân quyết toán ${currentYear}`);
  } else if (/\b(?:gia tri gia tang|gtgt)\b/.test(normalized)) {
    queries.push(`thuế giá trị gia tăng ${currentYear} sửa đổi bổ sung`);
  } else if (/\b(?:thu nhap doanh nghiep|tndn)\b/.test(normalized)) {
    queries.push(`thuế thu nhập doanh nghiệp ${currentYear} sửa đổi bổ sung`);
  }

  return Array.from(new Set(queries)).slice(0, 3);
}

function mergeSources(groups: OnlineLegalSource[][]) {
  const byUrl = new Map<string, OnlineLegalSource>();
  for (const source of groups.flat()) {
    const existing = byUrl.get(source.url);
    if (!existing || source.score > existing.score) {
      byUrl.set(source.url, source);
    }
  }
  return [...byUrl.values()];
}

function parseGovernmentResults(html: string, hint: string): OnlineLegalSource[] {
  const rows: Array<{ url: string; title: string; snippet: string; score: number }> = [];
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
    const normalizedTitle = normalize(title);
    const normalizedSnippet = normalize(snippet);
    const exactTitle = normalizedHint.length >= 4 && normalizedTitle.includes(normalizedHint);
    const related = normalizedHint.length >= 4 && normalizedSnippet.includes(normalizedHint);
    rows.push({ url, title, snippet, score: exactTitle ? 1.35 : related ? 0.84 : 0.55 });
  }

  return rows
    .sort((left, right) => right.score - left.score)
    .slice(0, 18)
    .map((row) => ({
      id: `government-${createHash("sha256").update(row.url).digest("hex").slice(0, 20)}`,
      title: row.title,
      url: row.url,
      snippet: row.snippet || "Kết quả từ Hệ thống văn bản Chính phủ.",
      score: row.score,
      source_label: "Hệ thống văn bản Chính phủ",
      previewable: true,
    }));
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
  const gazetteSettled = await Promise.allSettled(queries.map((item) => searchGazetteDocuments(item)));
  const gazetteGroups = gazetteSettled
    .filter((result): result is PromiseFulfilledResult<OnlineLegalSource[]> => result.status === "fulfilled")
    .map((result) => result.value);
  const gazetteSources = mergeSources(gazetteGroups);

  if (gazetteSources.length) {
    return {
      draft_answer: "Đã tìm thấy nguồn chính thức và tệp toàn văn trên Công báo điện tử Chính phủ.",
      sources: gazetteSources,
    };
  }

  const gazetteMessages = gazetteSettled
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => (result.reason instanceof Error ? result.reason.message : ""))
    .filter(Boolean);

  try {
    const sources = await searchGovernmentDocuments(query);
    if (sources.length) {
      return {
        draft_answer: "Đã tìm thấy nguồn chính thức trên Hệ thống văn bản Chính phủ và đang đọc toàn văn.",
        sources,
      };
    }
  } catch (governmentError) {
    const messages = [
      ...gazetteMessages,
      governmentError instanceof Error ? governmentError.message : "",
    ]
      .filter(Boolean)
      .join(" ");
    throw new Error(messages || "Không kết nối được các nguồn pháp luật chính thức.");
  }

  throw new Error("Không tìm thấy văn bản khớp trên các nguồn pháp luật chính thức. Hãy kiểm tra lại số hiệu, năm và cơ quan ban hành.");
}
