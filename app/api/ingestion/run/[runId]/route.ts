import { NextResponse } from "next/server";
import { getRun } from "workflow/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { runId } = await params;
  try {
    const run = await getRun(runId);
    const [status, workflowName, createdAt, startedAt, completedAt, returnValue] = await Promise.all([
      run.status,
      run.workflowName,
      run.createdAt,
      run.startedAt,
      run.completedAt,
      run.returnValue.catch(() => null),
    ]);
    return NextResponse.json(
      {
        run_id: runId,
        status,
        workflow_name: workflowName,
        created_at: toIso(createdAt),
        started_at: toIso(startedAt),
        completed_at: toIso(completedAt),
        return_value: returnValue,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: `Không tìm thấy workflow run ${runId}.` }, { status: 404 });
  }
}
