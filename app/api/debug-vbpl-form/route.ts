import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function attrs(tag: string) {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*["']([^"']*)["']/giu)) result[match[1]] = match[2];
  return result;
}

export async function GET() {
  const response = await fetch("https://vbpl.moj.gov.vn/TW/Pages/vbpq-timkiem.aspx", {
    cache: "no-store",
    headers: { "user-agent": "Mozilla/5.0 Chrome/131 Safari/537.36", "accept-language": "vi-VN,vi;q=0.9" },
  });
  const html = await response.text();
  const inputs = [...html.matchAll(/<input\b[^>]*>/giu)].map((match) => attrs(match[0])).filter((item) => item.name || item.id);
  const selects = [...html.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/giu)].map((match) => ({
    ...attrs(match[0].match(/<select\b[^>]*>/iu)?.[0] || ""),
    options: [...match[0].matchAll(/<option\b[^>]*value=["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/giu)].map((option) => ({ value: option[1], label: option[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() })),
  })).filter((item) => item.name || item.id);
  const forms = [...html.matchAll(/<form\b[^>]*>/giu)].map((match) => attrs(match[0]));
  return NextResponse.json({ status: response.status, forms, inputs, selects });
}
