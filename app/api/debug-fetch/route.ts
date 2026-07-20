import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JS_URL = "https://static.mediacdn.vn/CongBao/min/main-06042026v1.min.js";
const NEEDLES = [
  "/api/keyword/getlistbysymbol.htm",
  "/api/keyword/getlistbykeyword.htm",
  "/api/document/get-documents-by-publishdate-documenttype.htm",
];

function context(text: string, needle: string) {
  const index = text.indexOf(needle);
  if (index < 0) return null;
  return text.slice(Math.max(0, index - 1800), Math.min(text.length, index + needle.length + 4500));
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
      contexts: Object.fromEntries(NEEDLES.map((needle) => [needle, context(text, needle)])),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
