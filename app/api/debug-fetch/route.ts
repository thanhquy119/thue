import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOME_URL = "https://congbao.chinhphu.vn/van-ban-dang-cong-bao.htm";

function decodeHtml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function cookieHeader(headers: Headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const source = values.length ? values : headers.get("set-cookie") ? [headers.get("set-cookie") as string] : [];
  return source.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}

function findCsrf(html: string) {
  const patterns = [
    /name=["']_csrf["'][^>]*value=["']([^"']+)["']/iu,
    /value=["']([^"']+)["'][^>]*name=["']_csrf["']/iu,
    /["']_csrf["']\s*:\s*["']([^"']+)["']/iu,
    /csrfToken\s*[=:]\s*["']([^"']+)["']/iu,
    /_csrf=([^&"'\s<>]+)/iu,
  ];
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1];
    if (value) return decodeHtml(value);
  }
  return "";
}

export async function GET() {
  const headers = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
    "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
  };
  const initial = await fetch(HOME_URL, { cache: "no-store", headers });
  const initialHtml = await initial.text();
  const cookie = cookieHeader(initial.headers);
  const csrf = findCsrf(initialHtml);

  const url = new URL("https://congbao.chinhphu.vn/tim-kiem-van-ban");
  if (csrf) url.searchParams.set("_csrf", csrf);
  url.searchParams.set("q", "100/2024/NĐ-CP");
  const searched = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    headers: { ...headers, referer: HOME_URL, ...(cookie ? { cookie } : {}) },
  });
  const html = await searched.text();
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)]
    .map((match) => {
      let value = "";
      try {
        value = new URL(decodeHtml(match[1]), url).toString();
      } catch {}
      return { url: value, title: stripTags(match[2]) };
    })
    .filter((item) => /\/van-ban\/|tai-ve-van-ban/iu.test(item.url) || /100\s*\/\s*2024\s*\/\s*N[ĐD]-CP/iu.test(item.title))
    .filter((item, index, all) => item.url && all.findIndex((candidate) => candidate.url === item.url) === index)
    .slice(0, 40);

  return NextResponse.json(
    {
      initialStatus: initial.status,
      cookiePresent: Boolean(cookie),
      csrfPresent: Boolean(csrf),
      csrfLength: csrf.length,
      searchUrl: url.toString(),
      searchStatus: searched.status,
      resolvedUrl: searched.url,
      htmlLength: html.length,
      exactNumberFound: /100\s*\/\s*2024\s*\/\s*N[ĐD]-CP/iu.test(stripTags(html)),
      links,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
