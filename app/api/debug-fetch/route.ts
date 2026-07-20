import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_URL = "https://congbao.chinhphu.vn/van-ban-dang-cong-bao.htm?ky-hieu=100%2F2024%2FN%C4%90-CP";
const NEEDLES = [
  "searchvanban",
  "txtKyHieu",
  "ky-hieu",
  "tu-khoa",
  "get-documents",
  "getlistbysymbol",
  "data-atc",
  "ajaxDomain",
  "eth.cnnd.vn",
];

function allContexts(text: string, needle: string) {
  const lower = text.toLocaleLowerCase("vi");
  const target = needle.toLocaleLowerCase("vi");
  const values: Array<{ index: number; context: string }> = [];
  let offset = 0;
  while (values.length < 20) {
    const index = lower.indexOf(target, offset);
    if (index < 0) break;
    values.push({
      index,
      context: text.slice(Math.max(0, index - 5000), Math.min(text.length, index + target.length + 12000)),
    });
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
  const text = await response.text();
  const scripts = [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)].map((match, index) => ({
    index,
    attrs: match[1],
    length: match[2].length,
    matches: NEEDLES.filter((needle) => match[2].toLocaleLowerCase("vi").includes(needle.toLocaleLowerCase("vi"))),
    body: NEEDLES.some((needle) => match[2].toLocaleLowerCase("vi").includes(needle.toLocaleLowerCase("vi")))
      ? match[2].slice(0, 120000)
      : "",
  }));
  return NextResponse.json(
    {
      status: response.status,
      resolvedUrl: response.url,
      length: text.length,
      contexts: Object.fromEntries(NEEDLES.map((needle) => [needle, allContexts(text, needle)])),
      matchingScripts: scripts.filter((script) => script.matches.length),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
