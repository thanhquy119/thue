import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JS_URL = "https://static.mediacdn.vn/CongBao/min/main-06042026v1.min.js";
const NEEDLES = [
  "/api/document/get-documents-by-publishdate-documenttype.htm",
  "/api/keyword/getlistbykeyword.htm",
  "/api/keyword/getlistbysymbol.htm",
  "ky-hieu",
  "tu-khoa",
  "txtKyHieu",
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
      context: text.slice(Math.max(0, index - 6000), Math.min(text.length, index + target.length + 12000)),
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
  return NextResponse.json(
    {
      status: response.status,
      length: text.length,
      contexts: Object.fromEntries(NEEDLES.map((needle) => [needle, allContexts(text, needle)])),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
