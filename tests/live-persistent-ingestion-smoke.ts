import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GET as cronApiGet } from "../app/api/cron/legal-ingestion/route.ts";
import { POST as searchApiPost } from "../app/api/search/route.ts";
import {
  durableStoreAccess,
  readDurableIngestionState,
  readDurableRevision,
  readDurableStoreUsage,
  verifyDurableStore,
} from "../lib/legal/durable-document-store.ts";
import type { DurableLegalSource } from "../lib/legal/durable-ingestion-types.ts";
import type { TaxSearchResponse } from "../lib/legal/types.ts";
import { legalDocumentIngestionWorkflow } from "../workflows/legal-document-ingestion.ts";

const PERSISTENT_MARKER = "[live-persistent]";
const REVALIDATE_94_MARKER = "[live-revalidate-94]";
const CRON_MARKER = "[live-cron]";
const commitMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "";
const revalidate94Enabled =
  process.env.RUN_LIVE_OCR_REVALIDATION === "true" || commitMessage.includes(REVALIDATE_94_MARKER);
const persistentEnabled =
  process.env.RUN_LIVE_PERSISTENT_INGESTION === "true" || commitMessage.includes(PERSISTENT_MARKER);
const cronEnabled =
  process.env.RUN_LIVE_CRON_SMOKE === "true" || commitMessage.includes(CRON_MARKER);

const SOURCE_82: DurableLegalSource = {
  number: "82/2026/TT-BTC",
  title: "Thông tư số 82/2026/TT-BTC",
  type: "Thông tư",
  issuer: "Bộ Tài chính",
  issuedDate: null,
  effectiveDate: null,
  officialPageUrl: "https://congbao.chinhphu.vn/van-ban/thong-tu-so-82-2026-tt-btc-469980.htm",
  sourceUrl: "https://congbao.chinhphu.vn/van-ban/thong-tu-so-82-2026-tt-btc-469980.htm",
  sourceLabel: "Công báo điện tử Chính phủ",
};

const SOURCE_94: DurableLegalSource = {
  number: "94/2026/TT-BTC",
  title: "Thông tư số 94/2026/TT-BTC quy định về quản lý tuân thủ và quản lý rủi ro trong quản lý thuế",
  type: "Thông tư",
  issuer: "Bộ Tài chính",
  issuedDate: "2026-07-01",
  effectiveDate: "2026-07-01",
  officialPageUrl: "https://vanban.chinhphu.vn/?pageid=27160&docid=218894&classid=1",
  sourceUrl: "https://vanban.chinhphu.vn/?pageid=27160&docid=218894&classid=1",
  sourceLabel: "Hệ thống văn bản Chính phủ",
};

type CronDryRunPayload = {
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

function configureDurableStoreDefaults() {
  process.env.LEGAL_BLOB_ACCESS ||= "private";
  process.env.LEGAL_BLOB_SOFT_LIMIT_BYTES ||= "750000000";
  process.env.LEGAL_RUN_RETENTION_DAYS ||= "30";
}

async function callSearchApi(number: string) {
  const response = await searchApiPost(
    new Request("https://preview.thue-ro.local/api/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `persistent-smoke-${randomUUID()}`,
      },
      body: JSON.stringify({ query: number }),
    }),
  );
  if (response.status !== 200) {
    throw new Error(`POST /api/search trả ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return (await response.json()) as TaxSearchResponse;
}

async function verifyCronDryRun() {
  configureDurableStoreDefaults();
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  assert.ok(secret.length >= 16, "CRON_SECRET chưa được cấu hình cho Preview.");

  const endpoint = "https://preview.thue-ro.local/api/cron/legal-ingestion?dry_run=1";
  const unauthorized = await cronApiGet(new Request(endpoint));
  assert.equal(unauthorized.status, 401, "Cron phải từ chối request không có Bearer secret.");

  const authorized = await cronApiGet(
    new Request(endpoint, {
      headers: { authorization: `Bearer ${secret}` },
    }),
  );
  if (authorized.status !== 200) {
    throw new Error(`Cron dry-run trả ${authorized.status}: ${(await authorized.text()).slice(0, 800)}`);
  }
  const payload = (await authorized.json()) as CronDryRunPayload;
  assert.equal(payload.ok, true);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.cleanup.skipped, "dry_run");
  assert.deepEqual(payload.started, [], "Dry-run tuyệt đối không được khởi động Workflow.");
  assert.ok(payload.discovered >= 1, "Cron discovery không tìm thấy văn bản nào.");

  const skipped = new Map(payload.skipped.map((item) => [item.number, item.reason]));
  assert.equal(skipped.get(SOURCE_82.number), "ready", "Cron phải bỏ qua 82 đã ready.");
  assert.equal(skipped.get(SOURCE_94.number), "ready", "Cron phải bỏ qua 94 đã ready.");
  assert.equal(payload.would_start.includes(SOURCE_82.number), false);
  assert.equal(payload.would_start.includes(SOURCE_94.number), false);

  console.log("[live-cron-result]", JSON.stringify({
    unauthorizedStatus: unauthorized.status,
    authorizedStatus: authorized.status,
    dryRun: payload.dry_run,
    discovered: payload.discovered,
    wouldStart: payload.would_start,
    skippedReady: payload.skipped.filter((item) =>
      item.number === SOURCE_82.number || item.number === SOURCE_94.number),
    deferred: payload.deferred,
    cleanup: payload.cleanup,
    usageBeforeRuns: payload.usage_before_runs,
    warnings: payload.warnings,
  }));
  console.log("[live-cron] authentication, idempotency and no-start dry-run passed");
}

async function revalidateOcr94() {
  configureDurableStoreDefaults();
  assert.equal(durableStoreAccess(), "private");

  const before = await readDurableIngestionState(SOURCE_94.number);
  assert.ok(before?.runId, "Không tìm thấy runId chứa checkpoint OCR của Thông tư 94.");
  assert.equal(before?.processedPages, 35);
  assert.equal(before?.totalPages, 35);

  const startedAt = Date.now();
  const result = await legalDocumentIngestionWorkflow({
    jobId: before.runId,
    source: SOURCE_94,
    persist: true,
    reuseExistingCheckpoints: true,
  });
  const durationMs = Date.now() - startedAt;

  assert.equal(result.status, "ready", result.error ?? result.warnings.join(" "));
  assert.equal(result.processedPages, 35);
  assert.equal(result.totalPages, 35);
  assert.equal(result.revision?.validation.accepted, true);
  assert.deepEqual(result.revision?.validation.warnings, []);
  assert.ok((result.revision?.document.official_text.length ?? 0) > 60_000);
  assert.ok((result.revision?.document.quality_score ?? 0) > 0.99);

  const [state, revision, apiResult] = await Promise.all([
    readDurableIngestionState(SOURCE_94.number),
    readDurableRevision(SOURCE_94.number),
    callSearchApi(SOURCE_94.number),
  ]);
  assert.equal(state?.status, "ready");
  assert.equal(state?.stage, "completed");
  assert.equal(state?.processedPages, 35);
  assert.equal(revision?.revisionId, result.revision?.revisionId);
  assert.equal(revision?.validation.accepted, true);
  assert.equal(apiResult.document?.number, SOURCE_94.number);
  assert.equal(apiResult.document?.extraction_method, "ocr");
  assert.ok((apiResult.document?.official_text.length ?? 0) > 60_000);
  assert.ok((apiResult.document?.quality_score ?? 0) > 0.99);

  console.log("[live-revalidate-94-result]", JSON.stringify({
    jobId: before.runId,
    durationMs,
    status: result.status,
    processedPages: result.processedPages,
    totalPages: result.totalPages,
    qualityScore: revision?.document.quality_score,
    minimumPageScore: revision?.validation.metrics.minimumPageScore,
    characters: revision?.document.official_text.length,
    revisionId: revision?.revisionId,
    sourceSha256: revision?.sourceSha256,
    apiSearch: {
      documentNumber: apiResult.document?.number,
      extractionMethod: apiResult.document?.extraction_method,
      characters: apiResult.document?.official_text.length,
      confidence: apiResult.confidence,
    },
  }));
  console.log("[live-revalidate-94] checkpoint reuse, publish and /api/search lookup passed");
}

async function verifyPersistent82() {
  configureDurableStoreDefaults();

  console.log("[live-persistent] verifying private Blob read/write/delete");
  const storage = await verifyDurableStore();
  assert.equal(storage.ok, true, storage.error ?? "Blob healthcheck failed.");
  assert.equal(durableStoreAccess(), "private");

  const before = await readDurableStoreUsage();
  const jobId = `build-smoke-${randomUUID()}`;
  const result = await legalDocumentIngestionWorkflow({
    jobId,
    source: SOURCE_82,
    persist: true,
  });
  assert.equal(result.status, "ready", result.error ?? result.warnings.join(" "));
  assert.equal(result.number, SOURCE_82.number);
  assert.ok(result.revision?.validation.accepted);
  assert.ok((result.revision?.document.official_text.length ?? 0) > 5_000);

  const [state, revision, after, apiResult] = await Promise.all([
    readDurableIngestionState(SOURCE_82.number),
    readDurableRevision(SOURCE_82.number),
    readDurableStoreUsage(),
    callSearchApi(SOURCE_82.number),
  ]);
  assert.equal(state?.status, "ready");
  assert.equal(state?.stage, "completed");
  assert.equal(revision?.revisionId, result.revision?.revisionId);
  assert.equal(revision?.document.number, SOURCE_82.number);
  assert.equal(revision?.validation.accepted, true);
  assert.equal(apiResult.document?.number, SOURCE_82.number);
  assert.equal(apiResult.document?.extraction_method, "docx");
  assert.ok((apiResult.document?.official_text.length ?? 0) > 5_000);
  assert.equal(apiResult.document?.quality_score, 1);
  assert.match(apiResult.document?.source_label ?? "", /Công báo|chính thức|Blob|revision/iu);

  console.log("[live-persistent-result]", JSON.stringify({
    storage,
    jobId,
    status: result.status,
    extractionMethod: result.extractionMethod,
    qualityScore: revision?.document.quality_score,
    characters: revision?.document.official_text.length,
    revisionId: revision?.revisionId,
    sourceSha256: revision?.sourceSha256,
    usageBefore: before,
    usageAfter: after,
    apiSearch: {
      documentNumber: apiResult.document?.number,
      extractionMethod: apiResult.document?.extraction_method,
      characters: apiResult.document?.official_text.length,
      confidence: apiResult.confidence,
    },
  }));
  console.log("[live-persistent] private Blob ingestion and /api/search lookup passed");
}

async function main() {
  if (cronEnabled) {
    await verifyCronDryRun();
    return;
  }
  if (revalidate94Enabled) {
    await revalidateOcr94();
    return;
  }
  if (persistentEnabled) {
    await verifyPersistent82();
    return;
  }
  console.log(
    `[live-persistent] skipped; add ${PERSISTENT_MARKER}, ${REVALIDATE_94_MARKER} or ${CRON_MARKER} to the commit message, or set the matching live-smoke environment variable.`,
  );
}

main().catch((error) => {
  const label = cronEnabled ? "[live-cron]" : revalidate94Enabled ? "[live-revalidate-94]" : "[live-persistent]";
  console.error(`${label} failed`, error);
  process.exitCode = 1;
});
