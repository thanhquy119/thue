import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_URL = "https://congbao.chinhphu.vn/van-ban-dang-cong-bao.htm";
const NEEDLES = [
  "getlistbysymbol",
  "getlistbykeyword",
  "searchvanban",
  "txtKyHieu",
  "ky-hieu",
  "tu-khoa",
  "ajaxDomain",
  "eth.cnnd.vn",
  "/api/keyword",
  "documenttype",
];

function contexts(text: string, needle: string) {
  const lower = text.toLocaleLowerCase("vi");
  const target = needle.toLocaleLowerCase("vi");
  const values: Array<{ index: number; context: string }> = [];
  let offset = 0;
  while (values.length < 5) {
    const index = lower.indexOf(target, offset);
    if (index < 0) break;
    values.push({ index, context: text.slice(Math.max(0, index - 700), Math.min(text.length, index + target.length + 1400)) });
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
  return NextResponse.json(
    {
      status: response.status,
      length: text.length,
      contexts: Object.fromEntries(NEEDLES.map((needle) => [needle, contexts(text, needle)])),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
