import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getRun, start } from "workflow/api";
import {
  durableStoreConfigured,
  verifyDurableStore,
} from "@/lib/legal/durable-document-store";
import { discoverTaxDocumentByNumber } from "@/lib/legal/recent-tax-discovery";
import { legalDocumentIngestionWorkflow } from "@/workflows/legal-document-ingestion";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

async function statusResponse(runId: string) {
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
      { headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } },
    );
  } catch {
    return NextResponse.json({ error: `Không tìm thấy workflow run ${runId}.` }, { status: 404 });
  }
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV === "production") {
    return new Response(null, { status: 404 });
  }
  const url = new URL(request.url);
  const runId = url.searchParams.get("run_id")?.trim() ?? "";
  if (runId) return statusResponse(runId);

  if (url.searchParams.get("check") === "storage") {
    const result = await verifyDurableStore();
    return NextResponse.json(result, {
      status: result.ok ? 200 : 503,
      headers: { "cache-control": "no-store", "x-robots-tag": "noindex" },
    });
  }

  const number = url.searchParams.get("number")?.trim().slice(0, 100) ?? "";
  const sourceUrl = url.searchParams.get("source_url")?.trim() ?? "";
  if (!number) {
    return NextResponse.json({ error: "Thiếu number." }, { status: 400 });
  }

  const persist = url.searchParams.get("persist") === "1";
  if (persist && !durableStoreConfigured()) {
    return NextResponse.json(
      { error: "Vercel Blob chưa được cấu hình cho Preview." },
      { status: 503 },
    );
  }

  const customSource = sourceUrl
    ? {
        number,
        title: url.searchParams.get("title")?.trim() || `Văn bản số ${number}`,
        type: /\/TT-/iu.test(number) ? "Thông tư" : "Văn bản pháp luật",
        issuer: /TT-BTC$/iu.test(number) ? "Bộ Tài chính" : "",
        issuedDate: url.searchParams.get("issued_date")?.trim() || null,
        effectiveDate: url.searchParams.get("effective_date")?.trim() || null,
        officialPageUrl: url.searchParams.get("official_page_url")?.trim() || sourceUrl,
        sourceUrl,
        sourceLabel: "Nguồn smoke test được chỉ định trên Preview",
      }
    : null;
  const discovered = customSource ? null : await discoverTaxDocumentByNumber(number).catch(() => null);
  const source = customSource ?? discovered;
  if (!source) {
    return NextResponse.json({ error: `Không tìm thấy nguồn chính xác ${number}.` }, { status: 404 });
  }

  const jobId = randomUUID();
  const run = await start(legalDocumentIngestionWorkflow, [{ jobId, source, persist }]);
  return NextResponse.json(
    {
      ok: true,
      job_id: jobId,
      run_id: run.runId,
      number: source.number,
      source_url: source.sourceUrl,
      persist,
    },
    { status: 202, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } },
  );
}
