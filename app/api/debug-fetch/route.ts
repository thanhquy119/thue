import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function decode(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export async function GET() {
  const url = "https://vanban.chinhphu.vn/he-thong-van-ban?classid=1&mode=1";
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
    },
  });
  const html = await response.text();
  const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/giu)]
    .map((match) => match[0])
    .filter((form) => /TÌM KIẾM VĂN BẢN|Nhập từ khóa|search|timkiem|keyword/iu.test(form))
    .map((form) => ({
      opening: decode(form.match(/<form\b[^>]*>/iu)?.[0] ?? ""),
      controls: [...form.matchAll(/<(?:input|select|button)\b[^>]*>/giu)].map((control) => decode(control[0])).slice(0, 80),
      scripts: [...form.matchAll(/(?:onclick|onsubmit)=["']([^"']+)["']/giu)].map((item) => decode(item[1])).slice(0, 20),
      preview: decode(form.slice(0, 5000)),
    }));

  const keywordContexts = [...html.matchAll(/.{0,300}(?:Nhập từ khóa|TÌM KIẾM VĂN BẢN|keyword|timkiem|search).{0,800}/giu)]
    .map((match) => decode(match[0]))
    .slice(0, 30);

  return NextResponse.json(
    { status: response.status, resolvedUrl: response.url, forms, keywordContexts },
    { headers: { "cache-control": "no-store" } },
  );
}
