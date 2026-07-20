import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const urls = [
  "https://vbpl.vn/TW/Pages/vbpq-timkiem.aspx?Keyword=100%2F2024%2FN%C4%90-CP",
  "https://congbao.chinhphu.vn/tim-kiem-van-ban?q=100%2F2024%2FN%C4%90-CP",
  "https://vanban.chinhphu.vn/he-thong-van-ban?classid=1&mode=1&keyword=100%2F2024%2FN%C4%90-CP",
  "https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=169712",
  "https://vanban.chinhphu.vn/?classid=1&docid=210760&pageid=27160&typegroupid=4",
];

export async function GET() {
  const results = await Promise.all(
    urls.map(async (url) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
          headers: {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
            "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
          },
        });
        const text = await response.text();
        return {
          url,
          status: response.status,
          resolvedUrl: response.url,
          contentType: response.headers.get("content-type"),
          length: text.length,
          hasExactNumber: /100\s*\/\s*2024\s*\/\s*N[ĐD]-CP/iu.test(text),
          itemId: text.match(/ItemID=(\d+)/i)?.[1] ?? null,
          docId: text.match(/docid=(\d+)/i)?.[1] ?? null,
          preview: text.slice(0, 300),
        };
      } catch (error) {
        return { url, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return NextResponse.json({ results }, { headers: { "cache-control": "no-store" } });
}
