import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import {
  cronIngestionDecision,
  cronRunLimit,
} from "@/lib/legal/cron-ingestion-policy";
import {
  cleanupExpiredDurableRunCheckpoints,
  durableStoreConfigured,
  readDurableIngestionState,
  readDurableRevision,
  readDurableStoreUsage,
} from "@/lib/legal/durable-document-store";
import { discoverRecentTaxDocuments } from "@/lib/legal/recent-tax-discovery";
import type { DurableLegalSource } from "@/lib/legal/durable-ingestion-types";
import { dispatchPublishedDocumentNotifications } from "@/lib/notifications/push-service";
import { cleanupExpiredPushReceipts } from "@/lib/notifications/push-store";
import { legalDocumentIngestionWorkflow } from "@/workflows/legal-document-ingestion";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return process.env.VERCEL_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function notificationRevisionLimit() {
  const parsed = Number(process.env.WEB_PUSH_CRON_MAX_REVISIONS ?? 2);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(4, Math.floor(parsed)) : 2;
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

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const force = url.searchParams.get("force") === "1";
  const cleanup = dryRun
    ? { deletedObjects: 0, deletedBytes: 0, skipped: "dry_run" }
    : await cleanupExpiredDurableRunCheckpoints().catch((error) => ({
        deletedObjects: 0,
        deletedBytes: 0,
        error: error instanceof Error ? error.message : "Không thể dọn checkpoint cũ.",
      }));
  const notificationCleanup = dryRun
    ? { deletedObjects: 0, deletedBytes: 0, skipped: "dry_run" }
    : await cleanupExpiredPushReceipts().catch((error) => ({
        deletedObjects: 0,
        deletedBytes: 0,
        error: error instanceof Error ? error.message : "Không thể dọn biên nhận Web Push cũ.",
      }));
  const usageBeforeRuns = await readDurableStoreUsage().catch(() => null);

  const discovery = await discoverRecentTaxDocuments();
  const notificationDispatches: Array<Record<string, unknown>> = [];
  if (!dryRun) {
    let processedRevisions = 0;
    for (const document of discovery.documents) {
      if (processedRevisions >= notificationRevisionLimit()) break;
      const revision = await readDurableRevision(document.number).catch(() => null);
      if (!revision?.validation.accepted) continue;
      const summary = await dispatchPublishedDocumentNotifications({
        revisionId: revision.revisionId,
        number: revision.document.number,
        title: revision.document.title,
        issuedDate: revision.document.issued_date,
        publishedAt: revision.publishedAt,
        accepted: revision.validation.accepted,
      }).catch((error) => ({
        eligible: true,
        alreadyDispatched: false,
        error: error instanceof Error ? error.message : "Không gửi được Web Push.",
      }));
      notificationDispatches.push({
        number: revision.document.number,
        revision_id: revision.revisionId,
        ...summary,
      });
      if (!("alreadyDispatched" in summary) || summary.alreadyDispatched !== true) processedRevisions += 1;
    }
  }

  const selected: DurableLegalSource[] = [];
  const skipped: Array<{ number: string; reason: string }> = [];
  for (const document of discovery.documents) {
    const current = await readDurableIngestionState(document.number).catch(() => null);
    const decision = cronIngestionDecision(current, force);
    if (decision.shouldStart) selected.push(document);
    else skipped.push({ number: document.number, reason: decision.reason });
  }

  const runLimit = cronRunLimit();
  const wouldStart = selected.slice(0, runLimit.effective);
  const started = [];
  if (!dryRun) {
    for (const document of wouldStart) started.push(await startDocument(document));
  }

  const warnings = [...discovery.warnings];
  if (runLimit.clamped) {
    warnings.push(
      `LEGAL_CRON_MAX_RUNS yêu cầu ${runLimit.requested}, nhưng hệ thống giới hạn ${runLimit.hardCap} Workflow/lượt để bảo vệ quota OCR miễn phí.`,
    );
  }

  return NextResponse.json(
    {
      ok: true,
      dry_run: dryRun,
      cleanup,
      notification_cleanup: notificationCleanup,
      notification_dispatches: notificationDispatches,
      usage_before_runs: usageBeforeRuns,
      discovered: discovery.documents.length,
      run_limit: runLimit,
      would_start: wouldStart.map((document) => document.number),
      started,
      skipped,
      deferred: selected.slice(runLimit.effective).map((document) => document.number),
      warnings,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
