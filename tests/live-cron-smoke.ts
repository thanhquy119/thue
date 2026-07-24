import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GET as cronApiGet } from "../app/api/cron/legal-ingestion/route.ts";

const MARKER = "[live-cron-route]";
const commitMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "";
const enabled = process.env.RUN_LIVE_CRON_SMOKE === "true" || commitMessage.includes(MARKER);

if (!enabled) {
  console.log(`[live-cron-route] skipped; add ${MARKER} to the commit message or set RUN_LIVE_CRON_SMOKE=true.`);
  process.exit(0);
}

const previousSecret = process.env.CRON_SECRET;
const smokeSecret = previousSecret?.trim() || `cron-smoke-${randomUUID()}-${randomUUID()}`;
process.env.CRON_SECRET = smokeSecret;
process.env.LEGAL_BLOB_ACCESS ||= "private";

try {
  const endpoint = "https://preview.thue-ro.local/api/cron/legal-ingestion?dry_run=1";
  const unauthorized = await cronApiGet(new Request(endpoint));
  assert.equal(unauthorized.status, 401, "Cron phải từ chối request không có Bearer secret.");

  const authorized = await cronApiGet(
    new Request(endpoint, {
      headers: { authorization: `Bearer ${smokeSecret}` },
    }),
  );
  if (authorized.status !== 200) {
    throw new Error(`Cron dry-run trả ${authorized.status}: ${(await authorized.text()).slice(0, 800)}`);
  }

  const payload = (await authorized.json()) as {
    ok: boolean;
    dry_run: boolean;
    cleanup: { deletedObjects: number; deletedBytes: number; skipped?: string };
    usage_before_runs: { bytes: number; objects: number } | null;
    discovered: number;
    would_start: string[];
    started: Array<{ number: string; job_id: string; run_id: string }>;
    skipped: Array<{ number: string; reason: string }>;
    deferred: string[];
    warnings: string[];
  };

  assert.equal(payload.ok, true);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.cleanup.skipped, "dry_run");
  assert.deepEqual(payload.started, [], "Dry-run tuyệt đối không được khởi động Workflow.");
  assert.ok(payload.discovered >= 1, "Cron discovery không tìm thấy văn bản nào.");

  const skipped = new Map(payload.skipped.map((item) => [item.number, item.reason]));
  assert.equal(skipped.get("82/2026/TT-BTC"), "ready", "Cron phải bỏ qua 82 đã ready.");
  assert.equal(skipped.get("94/2026/TT-BTC"), "ready", "Cron phải bỏ qua 94 đã ready.");
  assert.equal(payload.would_start.includes("82/2026/TT-BTC"), false);
  assert.equal(payload.would_start.includes("94/2026/TT-BTC"), false);

  console.log("[live-cron-route-result]", JSON.stringify({
    unauthorizedStatus: unauthorized.status,
    authorizedStatus: authorized.status,
    secretSource: previousSecret?.trim() ? "preview_env" : "ephemeral_smoke_only",
    dryRun: payload.dry_run,
    discovered: payload.discovered,
    wouldStart: payload.would_start,
    skippedReady: payload.skipped.filter((item) =>
      item.number === "82/2026/TT-BTC" || item.number === "94/2026/TT-BTC"),
    deferred: payload.deferred,
    cleanup: payload.cleanup,
    usageBeforeRuns: payload.usage_before_runs,
    warnings: payload.warnings,
  }));
  console.log("[live-cron-route] authentication, discovery, idempotency and no-start dry-run passed");
} finally {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
}
