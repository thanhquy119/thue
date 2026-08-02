import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { POST as search } from "@/app/api/search/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ token: string }> };

function expectedToken() {
  return createHash("sha256")
    .update(`legal-search-e2e:${process.env.VERCEL_DEPLOYMENT_ID || "local"}:verified-rules`)
    .digest("hex")
    .slice(0, 24);
}

export async function GET(request: Request, context: RouteContext) {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "Smoke route không chạy ở production." }, { status: 404 });
  }

  const { token } = await context.params;
  if (token !== expectedToken()) {
    return NextResponse.json({ error: "Token smoke không hợp lệ." }, { status: 401 });
  }

  const query = new URL(request.url).searchParams.get("query")?.trim();
  if (!query || query.length < 2 || query.length > 600) {
    return NextResponse.json({ error: "Câu hỏi smoke không hợp lệ." }, { status: 400 });
  }

  const internal = new Request(new URL("/api/search", request.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Thue-Ro-legal-search-e2e-smoke",
      "x-forwarded-for": "127.0.0.1",
    },
    body: JSON.stringify({ query }),
  });

  return search(internal);
}
