import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {POST as startVideo} from "@/app/api/videos/start/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function expectedToken() {
  return createHash("sha256")
    .update(`legal-video-e2e:${process.env.VERCEL_DEPLOYMENT_ID || "local"}:r2-azure`)
    .digest("hex")
    .slice(0, 24);
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({error: "Smoke route không chạy ở production."}, {status: 404});
  }
  const url = new URL(request.url);
  if (url.searchParams.get("token") !== expectedToken()) {
    return NextResponse.json({error: "Token smoke không hợp lệ."}, {status: 401});
  }
  const query = url.searchParams.get("query")?.trim() || "178/2024/NĐ-CP";
  const internal = new Request(new URL("/api/videos/start", request.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Thuế Rõ legal-video e2e smoke",
      "x-forwarded-for": "127.0.0.1",
    },
    body: JSON.stringify({query, length: "brief", voice: "female"}),
  });
  return startVideo(internal);
}
