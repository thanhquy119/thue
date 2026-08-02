import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {start} from "workflow/api";
import {
  patchLegalVideoJob,
  publicLegalVideoJob,
  readLegalVideoJob,
} from "@/lib/video/store";
import {legalVideoGenerationWorkflow} from "@/workflows/legal-video-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = {params: Promise<{token: string; jobId: string}>};

function expectedToken() {
  return createHash("sha256")
    .update(`legal-video-resume:${process.env.VERCEL_DEPLOYMENT_ID || "local"}:r2-azure`)
    .digest("hex")
    .slice(0, 24);
}

export async function GET(_request: Request, context: RouteContext) {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({error: "Resume route không chạy ở production."}, {status: 404});
  }

  const {token, jobId} = await context.params;
  if (token !== expectedToken()) {
    return NextResponse.json({error: "Token resume không hợp lệ."}, {status: 401});
  }
  if (!/^[0-9a-f-]{20,64}$/iu.test(jobId)) {
    return NextResponse.json({error: "Mã job không hợp lệ."}, {status: 400});
  }

  const job = await readLegalVideoJob(jobId);
  if (!job) return NextResponse.json({error: "Không tìm thấy job video."}, {status: 404});
  if (job.status === "ready" && job.videoUrl) {
    return NextResponse.json({ok: true, reused: true, job: publicLegalVideoJob(job)});
  }

  const run = await start(legalVideoGenerationWorkflow, [{jobId}]);
  const updated = await patchLegalVideoJob(jobId, {
    workflowRunId: run.runId,
    status: "queued",
    progress: Math.min(job.progress, 38),
    message: "Đang tiếp tục job video từ checkpoint đã lưu…",
    error: null,
  });

  return NextResponse.json(
    {ok: true, resumed: true, job: publicLegalVideoJob(updated)},
    {status: 202, headers: {"cache-control": "no-store"}},
  );
}
