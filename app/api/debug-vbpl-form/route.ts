import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch("https://r.jina.ai/http://vbpl.vn/TW/Pages/vbpq-thuoctinh.aspx?ItemID=136460", {
      cache: "no-store",
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 Chrome/131 Safari/537.36" },
    });
    const text = await response.text();
    console.log("VBPL_PROXY_PROBE", JSON.stringify({ status: response.status, length: text.length, sample: text.slice(0, 2_000) }));
    return NextResponse.json({ ok: response.ok, status: response.status, length: text.length });
  } catch (error) {
    console.error("VBPL_PROXY_PROBE_ERROR", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    clearTimeout(timer);
  }
}
