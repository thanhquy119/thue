import {NextResponse} from "next/server";
import {publicLegalVideoJob, readLegalVideoJob} from "@/lib/video/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {params: Promise<{jobId: string}>};

export async function GET(_request: Request, context: RouteContext) {
  const {jobId} = await context.params;
  if (!/^[0-9a-f-]{20,64}$/iu.test(jobId)) {
    return NextResponse.json({error: "Mã job không hợp lệ."}, {status: 400});
  }
  const job = await readLegalVideoJob(jobId);
  if (!job) return NextResponse.json({error: "Không tìm thấy job video."}, {status: 404});
  return NextResponse.json({ok: true, job: publicLegalVideoJob(job)}, {
    headers: {"cache-control": "no-store"},
  });
}
