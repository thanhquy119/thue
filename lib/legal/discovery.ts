import { createHash } from "node:crypto";
import type { OnlineLegalSource } from "./types";

export type OfficialSourceDiscovery = {
  draft_answer: string;
  sources: OnlineLegalSource[];
};

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
    .replace(/\s+/g, "")
    .replace(/nd-cp/g, "nd-cp")
    .replace(/qd-/g, "qd-");
}

function documentNumberHint(query: string) {
  return (
    query.match(
      /\b\d{1,4}\s*\/\s*20\d{2}\s*\/\s*(?:NĐ-CP|ND-CP|TT-[A-ZĐ]+|NQ-[A-ZĐ0-9]+|QĐ-[A-ZĐa-z]+|QD-[A-Za-z]+|QH\d*|UBTVQH\d*)\b/iu,
    )?.[0] ?? query
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
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
    const score = exactTitle ? 1.35 : related ? 0.84 : 0.55;
    rows.push({ url, title, snippet, score });
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
  const initial = await fetchWithTimeout(GOVERNMENT_SEARCH_URL, {
    cache: "no-store",
    headers: COMMON_HEADERS,
  });
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
  let sources: OnlineLegalSource[] = [];
  try {
    sources = await searchGovernmentDocuments(query);
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Hệ thống văn bản Chính phủ phản hồi quá chậm."
      : error instanceof Error
        ? error.message
        : "Không kết nối được Hệ thống văn bản Chính phủ.";
    throw new Error(message);
  }

  if (!sources.length) {
    throw new Error(
      "Không tìm thấy văn bản khớp trên Hệ thống văn bản Chính phủ. Hãy kiểm tra lại số hiệu, năm và cơ quan ban hành.",
    );
  }

  return {
    draft_answer: "Đã tìm thấy nguồn chính thức trên Hệ thống văn bản Chính phủ và đang đọc toàn văn.",
    sources,
  };
}
