import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEARCH_URL = "https://vanban.chinhphu.vn/he-thong-van-ban?classid=1&mode=1";

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
  return decodeHtml(
    tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "iu"))?.[1] ?? "",
  );
}

function formFields(html: string) {
  const params = new URLSearchParams();
  for (const match of html.matchAll(/<input\b[^>]*>/giu)) {
    const tag = match[0];
    const name = attribute(tag, "name");
    if (!name) continue;
    const type = attribute(tag, "type").toLocaleLowerCase("en");
    if (type === "hidden") params.set(name, attribute(tag, "value"));
  }
  return params;
}

function cookieHeader(headers: Headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const source = values.length ? values : headers.get("set-cookie") ? [headers.get("set-cookie") as string] : [];
  return source.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function resultLinks(html: string) {
  const results: Array<{ url: string; title: string; context: string }> = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*(?:docid|docId)=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/giu)) {
    const href = decodeHtml(match[1]);
    let url = "";
    try {
      url = new URL(href, SEARCH_URL).toString();
    } catch {
      continue;
    }
    if (results.some((result) => result.url === url)) continue;
    const title = stripTags(match[2]);
    const start = Math.max(0, (match.index ?? 0) - 500);
    const end = Math.min(html.length, (match.index ?? 0) + match[0].length + 800);
    results.push({ url, title, context: stripTags(html.slice(start, end)) });
  }
  return results.slice(0, 30);
}

export async function GET() {
  const commonHeaders = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
    "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
  };

  const initial = await fetch(SEARCH_URL, { cache: "no-store", headers: commonHeaders });
  const initialHtml = await initial.text();
  const body = formFields(initialHtml);
  body.set("ctrl_191017_163$txtSearchKeyword", "100/2024/NĐ-CP");
  body.set("ctrl_191017_163$btnSearch", "Tìm kiếm");
  body.set("ctrl_191017_163$hidIsSearch", "1");
  body.delete("__EVENTTARGET");
  body.delete("__EVENTARGUMENT");

  const cookie = cookieHeader(initial.headers);
  const searched = await fetch(SEARCH_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      ...commonHeaders,
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://vanban.chinhphu.vn",
      referer: SEARCH_URL,
      ...(cookie ? { cookie } : {}),
    },
    body: body.toString(),
  });
  const searchedHtml = await searched.text();
  const links = resultLinks(searchedHtml);

  return NextResponse.json(
    {
      initialStatus: initial.status,
      searchStatus: searched.status,
      resolvedUrl: searched.url,
      cookiePresent: Boolean(cookie),
      hiddenFieldCount: Array.from(body.keys()).length,
      htmlLength: searchedHtml.length,
      exactNumberFound: /100\s*\/\s*2024\s*\/\s*N[ĐD]-CP/iu.test(searchedHtml),
      links,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
