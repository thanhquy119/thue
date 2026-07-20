import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_URL = "https://congbao.chinhphu.vn/van-ban-dang-cong-bao.htm";
const NEEDLES = [
  "searchvanban",
  "ddlLoaiThongTin",
  "searchFormDate",
  "data-search",
  "window.location",
  "location.href",
  "ajax",
  "XMLHttpRequest",
  "tim-kiem",
];

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

function contexts(text: string, needle: string) {
  const lower = text.toLocaleLowerCase("vi");
  const target = needle.toLocaleLowerCase("vi");
  const values: string[] = [];
  let offset = 0;
  while (values.length < 12) {
    const index = lower.indexOf(target, offset);
    if (index < 0) break;
    values.push(decodeHtml(text.slice(Math.max(0, index - 800), Math.min(text.length, index + target.length + 1800))));
    offset = index + target.length;
  }
  return values;
}

export async function GET() {
  const response = await fetch(PAGE_URL, {
    cache: "no-store",
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
    },
  });
  const html = await response.text();
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)].map((match, index) => ({
    index,
    attrs: decodeHtml(match[1]),
    body: decodeHtml(match[2]),
  }));

  const relevantScripts = scripts
    .map((script) => ({
      index: script.index,
      attrs: script.attrs,
      length: script.body.length,
      matches: NEEDLES.filter((needle) => script.body.toLocaleLowerCase("vi").includes(needle.toLocaleLowerCase("vi"))),
      snippets: Object.fromEntries(
        NEEDLES.map((needle) => [needle, contexts(script.body, needle)]).filter(([, values]) => (values as string[]).length),
      ),
      urlStrings: [...script.body.matchAll(/["'`]([^"'`\r\n]{1,400})["'`]/g)]
        .map((match) => match[1])
        .filter((value) => /search|tim-kiem|van-ban|ajax|api|congbao/iu.test(value))
        .filter((value, itemIndex, all) => all.indexOf(value) === itemIndex)
        .slice(0, 100),
    }))
    .filter((script) => script.matches.length || script.urlStrings.length);

  return NextResponse.json(
    {
      status: response.status,
      htmlLength: html.length,
      scriptCount: scripts.length,
      externalScripts: scripts.filter((script) => /\bsrc\s*=/iu.test(script.attrs)).map((script) => script.attrs),
      relevantScripts,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
