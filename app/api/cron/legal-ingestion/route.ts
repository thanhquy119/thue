import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import {
  durableStoreConfigured,
  readDurableIngestionState,
} from "@/lib/legal/durable-document-store";
import { discoverRecentTaxDocuments } from "@/lib/legal/recent-tax-discovery";
import type { DurableIngestionState, DurableLegalSource } from "@/lib/legal/durable-ingestion-types";
import { legalDocumentIngestionWorkflow } from "@/workflows/legal-document-ingestion";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return process.env.VERCEL_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function hoursSince(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? (Date.now() - time) / 3_600_000 : Number.POSITIVE_INFINITY;
}

function shouldStart(state: DurableIngestionState | null, force: boolean) {
  if (force || !state) return true;
  if (state.status === "ready" || state.status === "processing") return false;
  return hoursSince(state.updatedAt) >= 12;
}

async function startDocument(source: DurableLegalSource) {
  const jobId = randomUUID();
  const run = await start(legalDocumentIngestionWorkflow, [{ jobId, source, persist: true }]);
  return { number: source.number, job_id: jobId, run_id: run.runId };
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Cron secret không hợp lệ." }, { status: 401 });
  }
  if (!durableStoreConfigured()) {
    return NextResponse.json(
      {
        error: "Chưa kết nối Vercel Blob nên Cron không được phép tạo công việc không thể lưu checkpoint.",
        code: "BLOB_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }

  const force = new URL(request.url).searchParams.get("force") === "1";
  const discovery = await discoverRecentTaxDocuments();
  const selected: DurableLegalSource[] = [];
  const skipped: Array<{ number: string; reason: string }> = [];
  for (const document of discovery.documents) {
    const current = await readDurableIngestionState(document.number).catch(() => null);
    if (shouldStart(current, force)) selected.push(document);
    else skipped.push({
      number: document.number,
      reason: current?.status === "ready" ? "ready" : current?.status === "processing" ? "processing" : "retry_wait",
    });
  }

  const maxRuns = Math.max(1, Math.min(12, Number(process.env.LEGAL_CRON_MAX_RUNS || 8)));
  const started = [];
  for (const document of selected.slice(0, maxRuns)) started.push(await startDocument(document));

  return NextResponse.json(
    {
      ok: true,
      discovered: discovery.documents.length,
      started,
      skipped,
      deferred: selected.slice(maxRuns).map((document) => document.number),
      warnings: discovery.warnings,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
