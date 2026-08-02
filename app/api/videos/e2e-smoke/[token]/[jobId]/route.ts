import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {publicLegalVideoJob, readLegalVideoJob} from "@/lib/video/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {params: Promise<{token: string; jobId: string}>};

function expectedToken() {
  return createHash("sha256")
    .update(`legal-video-e2e:${process.env.VERCEL_DEPLOYMENT_ID || "local"}:r2-azure`)
    .digest("hex")
    .slice(0, 24);
}

export async function GET(_request: Request, context: RouteContext) {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({error: "Smoke route không chạy ở production."}, {status: 404});
  }
  const {token, jobId} = await context.params;
  if (token !== expectedToken()) {
    return NextResponse.json({error: "Token smoke không hợp lệ."}, {status: 401});
  }
  if (!/^[0-9a-f-]{20,64}$/iu.test(jobId)) {
    return NextResponse.json({error: "Mã job không hợp lệ."}, {status: 400});
  }
  const job = await readLegalVideoJob(jobId);
  if (!job) return NextResponse.json({error: "Không tìm thấy job video."}, {status: 404});
  return NextResponse.json({job: publicLegalVideoJob(job)}, {headers: {"cache-control": "no-store"}});
}
