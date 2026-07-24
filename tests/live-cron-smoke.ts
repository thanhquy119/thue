import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GET as cronApiGet } from "../app/api/cron/legal-ingestion/route.ts";
import { cronIngestionDecision } from "../lib/legal/cron-ingestion-policy.ts";
import { readDurableIngestionState } from "../lib/legal/durable-document-store.ts";

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
  const [state82, state94] = await Promise.all([
    readDurableIngestionState("82/2026/TT-BTC"),
    readDurableIngestionState("94/2026/TT-BTC"),
  ]);
  assert.equal(state82?.status, "ready", "Blob phải lưu 82 ở trạng thái ready.");
  assert.equal(state94?.status, "ready", "Blob phải lưu 94 ở trạng thái ready.");
  assert.equal(cronIngestionDecision(state82).shouldStart, false);
  assert.equal(cronIngestionDecision(state82).reason, "ready");
  assert.equal(cronIngestionDecision(state94).shouldStart, false);
  assert.equal(cronIngestionDecision(state94).reason, "ready");

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
    run_limit: { requested: number; effective: number; hardCap: number; clamped: boolean };
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
  assert.ok(payload.run_limit.effective >= 1);
  assert.ok(payload.run_limit.effective <= 2, "Cron free-tier không được vượt hai Workflow/lượt.");
  assert.equal(payload.run_limit.hardCap, 2);
  assert.ok(payload.would_start.length <= payload.run_limit.effective);
  if (payload.run_limit.clamped) {
    assert.match(payload.warnings.join(" "), /giới hạn 2 Workflow\/lượt/iu);
  }

  const protectedNumbers = ["82/2026/TT-BTC", "94/2026/TT-BTC"];
  const skipped = new Map(payload.skipped.map((item) => [item.number, item.reason]));
  for (const number of protectedNumbers) {
    assert.equal(payload.would_start.includes(number), false, `${number} không được nằm trong would_start.`);
    assert.equal(payload.started.some((item) => item.number === number), false, `${number} không được khởi động.`);
    assert.equal(payload.deferred.includes(number), false, `${number} không được nằm trong deferred.`);
    const reason = skipped.get(number);
    if (reason !== undefined) assert.equal(reason, "ready", `${number} chỉ được skip với lý do ready.`);
  }

  console.log("[live-cron-route-result]", JSON.stringify({
    unauthorizedStatus: unauthorized.status,
    authorizedStatus: authorized.status,
    secretSource: previousSecret?.trim() ? "preview_env" : "ephemeral_smoke_only",
    durableStates: {
      "82/2026/TT-BTC": state82?.status,
      "94/2026/TT-BTC": state94?.status,
    },
    dryRun: payload.dry_run,
    discovered: payload.discovered,
    runLimit: payload.run_limit,
    wouldStart: payload.would_start,
    skippedReady: payload.skipped.filter((item) => protectedNumbers.includes(item.number)),
    deferred: payload.deferred,
    cleanup: payload.cleanup,
    usageBeforeRuns: payload.usage_before_runs,
    warnings: payload.warnings,
  }));
  console.log("[live-cron-route] authentication, discovery, free-tier cap, ready-state idempotency and no-start dry-run passed");
} finally {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
}
