import {NextResponse} from "next/server";
import {signedR2MediaUrl} from "@/lib/video/r2-media";
import {readLegalVideoJob} from "@/lib/video/store";

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
  if (job.status !== "ready" || !job.videoPath) {
    return NextResponse.json(
      {error: job.status === "failed" ? "Video đã tạo thất bại." : "Video chưa sẵn sàng."},
      {status: 409, headers: {"cache-control": "no-store"}},
    );
  }
  return NextResponse.redirect(await signedR2MediaUrl(job.videoPath, 900), {
    status: 307,
    headers: {"cache-control": "private, no-store, max-age=0"},
  });
}
