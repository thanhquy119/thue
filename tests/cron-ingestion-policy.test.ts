import assert from "node:assert/strict";
import test from "node:test";
import {
  cronIngestionDecision,
  cronRunLimit,
} from "../lib/legal/cron-ingestion-policy.ts";
import type { DurableIngestionState } from "../lib/legal/durable-ingestion-types.ts";

const NOW = Date.parse("2026-07-24T06:30:00.000Z");

function state(
  status: DurableIngestionState["status"],
  updatedAt: string,
): DurableIngestionState {
  return {
    number: "94/2026/TT-BTC",
    status,
    stage: status === "processing" ? "ocr_processing" : "completed",
    runId: "run-test",
    sourceUrl: "https://congbao.chinhphu.vn/van-ban/test",
    extractionMethod: status === "ready" ? "ocr" : null,
    processedPages: status === "ready" ? 35 : 0,
    totalPages: status === "ready" ? 35 : 0,
    qualityScore: status === "ready" ? 0.99 : null,
    warnings: [],
    error: status === "failed" ? "temporary failure" : null,
    updatedAt,
  };
}

test("defaults Cron to one Workflow per daily run", () => {
  assert.deepEqual(cronRunLimit(undefined), {
    requested: 1,
    effective: 1,
    hardCap: 2,
    clamped: false,
  });
});

test("allows two Cron Workflows but no more on the free-tier policy", () => {
  assert.deepEqual(cronRunLimit("2"), {
    requested: 2,
    effective: 2,
    hardCap: 2,
    clamped: false,
  });
  assert.deepEqual(cronRunLimit("8"), {
    requested: 8,
    effective: 2,
    hardCap: 2,
    clamped: true,
  });
});

test("invalid Cron limits fall back to one instead of disabling ingestion", () => {
  for (const value of ["0", "invalid", "-2"]) {
    assert.equal(cronRunLimit(value).effective, 1, value);
  }
});

test("starts documents that have no durable state", () => {
  assert.deepEqual(cronIngestionDecision(null, false, NOW), {
    shouldStart: true,
    reason: "new",
    ageHours: null,
  });
});

test("never starts ready documents during an ordinary Cron run", () => {
  const decision = cronIngestionDecision(state("ready", "2026-07-20T00:00:00.000Z"), false, NOW);
  assert.equal(decision.shouldStart, false);
  assert.equal(decision.reason, "ready");
});

test("never starts documents that are already processing", () => {
  const decision = cronIngestionDecision(state("processing", "2026-07-24T05:30:00.000Z"), false, NOW);
  assert.equal(decision.shouldStart, false);
  assert.equal(decision.reason, "processing");
});

test("waits twelve hours before retrying needs-review and failed states", () => {
  for (const status of ["needs_review", "failed"] as const) {
    const waiting = cronIngestionDecision(state(status, "2026-07-23T19:00:00.000Z"), false, NOW);
    assert.equal(waiting.shouldStart, false, status);
    assert.equal(waiting.reason, "retry_wait", status);

    const due = cronIngestionDecision(state(status, "2026-07-23T18:30:00.000Z"), false, NOW);
    assert.equal(due.shouldStart, true, status);
    assert.equal(due.reason, "retry_due", status);
  }
});

test("force mode is explicit and can override idempotency", () => {
  const decision = cronIngestionDecision(state("ready", "2026-07-24T06:00:00.000Z"), true, NOW);
  assert.equal(decision.shouldStart, true);
  assert.equal(decision.reason, "forced");
});

test("invalid timestamps are treated as retry due instead of waiting forever", () => {
  const decision = cronIngestionDecision(state("failed", "invalid"), false, NOW);
  assert.equal(decision.shouldStart, true);
  assert.equal(decision.reason, "retry_due");
  assert.equal(decision.ageHours, Number.POSITIVE_INFINITY);
});
