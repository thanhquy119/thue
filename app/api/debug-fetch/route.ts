import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const URL_VALUE = "https://congbao.chinhphu.vn/van-ban-dang-cong-bao.htm";

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export async function GET() {
  const response = await fetch(URL_VALUE, {
    cache: "no-store",
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
    },
  });
  const html = await response.text();

  const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/giu)]
    .map((match) => decodeHtml(match[0]))
    .filter((form) => /tìm kiếm|search|keyword|query|tu.?khoa/iu.test(form))
    .map((form) => ({
      opening: form.match(/<form\b[^>]*>/iu)?.[0] ?? "",
      controls: [...form.matchAll(/<(?:input|select|button)\b[^>]*>/giu)].map((match) => match[0]).slice(0, 120),
      preview: form.slice(0, 10000),
    }));

  const contexts = [...html.matchAll(/.{0,600}(?:Tìm kiếm nâng cao|Tìm kiếm|keyword|search|query|tu.?khoa).{0,1600}/giu)]
    .map((match) => decodeHtml(match[0]))
    .slice(0, 40);

  const scriptSources = [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/giu)]
    .map((match) => {
      try {
        return new URL(decodeHtml(match[1]), URL_VALUE).toString();
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  return NextResponse.json(
    { status: response.status, htmlLength: html.length, forms, contexts, scriptSources },
    { headers: { "cache-control": "no-store" } },
  );
}
