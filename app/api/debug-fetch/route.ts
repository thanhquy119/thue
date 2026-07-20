import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JS_URL = "https://static.mediacdn.vn/CongBao/min/main-06042026v1.min.js";
const NEEDLES = [
  "searchvanban",
  "ddlLoaiThongTin",
  "searchFormDate",
  "data-atc",
  "data-search",
  "ajaxDomain",
  "eth.cnnd.vn",
  "location.href",
  "window.location",
  "encodeURIComponent",
  "SiteId",
];

function contexts(text: string, needle: string) {
  const lower = text.toLocaleLowerCase("vi");
  const target = needle.toLocaleLowerCase("vi");
  const values: Array<{ index: number; context: string }> = [];
  let offset = 0;
  while (values.length < 30) {
    const index = lower.indexOf(target, offset);
    if (index < 0) break;
    values.push({
      index,
      context: text.slice(Math.max(0, index - 1800), Math.min(text.length, index + target.length + 5000)),
    });
    offset = index + target.length;
  }
  return values;
}

export async function GET() {
  const response = await fetch(JS_URL, {
    cache: "no-store",
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      accept: "text/javascript,application/javascript,*/*;q=0.8",
    },
  });
  const text = await response.text();
  const result = Object.fromEntries(NEEDLES.map((needle) => [needle, contexts(text, needle)]));
  const urlStrings = [...text.matchAll(/["'`]([^"'`\r\n]{1,600})["'`]/g)]
    .map((match) => match[1])
    .filter((value) => /search|timkiem|tim-kiem|vanban|van-ban|ajax|api|sodo|congbao/iu.test(value))
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 400);
  return NextResponse.json(
    { status: response.status, resolvedUrl: response.url, length: text.length, result, urlStrings },
    { headers: { "cache-control": "no-store" } },
  );
}
