import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { cronIngestionDecision } from "@/lib/legal/cron-ingestion-policy";
import {
  durableStoreConfigured,
  readDurableIngestionState,
  readDurableRevision,
} from "@/lib/legal/durable-document-store";
import {
  claimFastTaxStarts,
  fastTaxDiscoveryStoreConfigured,
  recentFastTaxCandidateNumbers,
  recordFastTaxDiscovery,
} from "@/lib/legal/fast-tax-discovery-store";
import { discoverBroadTaxDocuments } from "@/lib/legal/recent-tax-discovery";
import type { DurableLegalSource } from "@/lib/legal/durable-ingestion-types";
import { dispatchPublishedDocumentNotifications } from "@/lib/notifications/push-service";
import { classifyStrictTaxDocumentForNotification } from "@/lib/notifications/tax-notification-policy";
import { legalDocumentIngestionWorkflow } from "@/workflows/legal-document-ingestion";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.DISCOVERY_CRON_SECRET || process.env.CRON_SECRET || "";
  if (!secret) return process.env.VERCEL_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(maximum, Math.floor(parsed));
}

function maximumStartsPerDay() {
  return positiveInteger(
    process.env.LEGAL_FAST_DISCOVERY_MAX_STARTS_PER_DAY,
    2,
    4,
  );
}

function maximumStartsPerRun() {
  return positiveInteger(
    process.env.LEGAL_FAST_DISCOVERY_MAX_STARTS_PER_RUN,
    1,
    2,
  );
}

function notificationScanLimit() {
  return positiveInteger(
    process.env.WEB_PUSH_FAST_SCAN_LIMIT,
    60,
    120,
  );
}

async function startDocument(source: DurableLegalSource) {
  const jobId = randomUUID();
  const run = await start(legalDocumentIngestionWorkflow, [
    { jobId, source, persist: true },
  ]);
  return { number: source.number, job_id: jobId, run_id: run.runId };
}

async function dispatchReadyNotifications(numbers: string[]) {
  const dispatches: Array<Record<string, unknown>> = [];
  for (const number of numbers.slice(0, notificationScanLimit())) {
    const revision = await readDurableRevision(number).catch(() => null);
    if (!revision?.validation.accepted) continue;
    const notification = {
      revisionId: revision.revisionId,
      number: revision.document.number,
      title: revision.document.title,
      issuedDate: revision.document.issued_date,
      publishedAt: revision.publishedAt,
      accepted: revision.validation.accepted,
      documentType: revision.document.type,
      issuer: revision.document.issuer,
      officialText: revision.document.official_text,
    };
    const classification = classifyStrictTaxDocumentForNotification(notification);
    if (!classification.eligible) continue;
    const summary = await dispatchPublishedDocumentNotifications(notification).catch(
      (error) => ({
        eligible: true,
        alreadyDispatched: false,
        error: error instanceof Error ? error.message : "Không gửi được Web Push.",
      }),
    );
    if (
      "alreadyDispatched" in summary &&
      summary.alreadyDispatched === true
    ) {
      continue;
    }
    dispatches.push({
      number: revision.document.number,
      revision_id: revision.revisionId,
      classification,
      ...summary,
    });
  }
  return dispatches;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: "Discovery Cron secret không hợp lệ." },
      { status: 401 },
    );
  }
  if (!durableStoreConfigured() || !fastTaxDiscoveryStoreConfigured()) {
    return NextResponse.json(
      {
        error: "Kho bền vững chưa được cấu hình cho phát hiện văn bản nhanh.",
        code: "DURABLE_STORE_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const notifyOnly = url.searchParams.get("notify_only") === "1";
  const nowIso = new Date().toISOString();

  let discovered: DurableLegalSource[] = [];
  let bootstrapped = false;
  let newNumbers: string[] = [];

  if (!notifyOnly) {
    discovered = await discoverBroadTaxDocuments();
    const recorded = await recordFastTaxDiscovery(discovered, nowIso);
    bootstrapped = recorded.bootstrapped;
    newNumbers = recorded.newNumbers;
  }

  const notificationNumbers = notifyOnly
    ? await recentFastTaxCandidateNumbers(notificationScanLimit())
    : Array.from(
        new Set([
          ...discovered.map((document) => document.number),
          ...(await recentFastTaxCandidateNumbers(notificationScanLimit())),
        ]),
      );
  const notificationDispatches = await dispatchReadyNotifications(
    notificationNumbers,
  );

  const sourceByNumber = new Map(
    discovered.map((source) => [source.number, source]),
  );
  const startCandidates: DurableLegalSource[] = [];
  if (!notifyOnly && !bootstrapped) {
    for (const number of newNumbers) {
      const source = sourceByNumber.get(number);
      if (!source) continue;
      const current = await readDurableIngestionState(number).catch(() => null);
      if (cronIngestionDecision(current).shouldStart) startCandidates.push(source);
    }
  }
  startCandidates.sort((left, right) =>
    String(right.issuedDate ?? "").localeCompare(String(left.issuedDate ?? "")),
  );

  const requested = startCandidates
    .slice(0, maximumStartsPerRun())
    .map((source) => source.number);
  const claim = await claimFastTaxStarts(
    requested,
    nowIso,
    maximumStartsPerDay(),
  );
  const claimed = new Set(claim.claimed);
  const started = [];
  for (const source of startCandidates) {
    if (!claimed.has(source.number)) continue;
    started.push(await startDocument(source));
  }

  return NextResponse.json(
    {
      ok: true,
      mode: notifyOnly ? "notify_only" : "discover_and_notify",
      bootstrapped,
      discovered: discovered.length,
      newly_seen: newNumbers,
      notification_dispatches: notificationDispatches,
      daily_start_limit: maximumStartsPerDay(),
      per_run_start_limit: maximumStartsPerRun(),
      started,
      deferred: startCandidates
        .filter((source) => !claimed.has(source.number))
        .map((source) => source.number),
      checked_at: nowIso,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
