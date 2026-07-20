import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() || "luật quản lí thuế 108";
  const response = await fetch(new URL("/api/search", request.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status, headers: { "cache-control": "no-store" } });
}
