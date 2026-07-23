import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  durableStoreAccess,
  readDurableIngestionState,
  readDurableRevision,
  readDurableStoreUsage,
  verifyDurableStore,
} from "../lib/legal/durable-document-store.ts";
import type { DurableLegalSource } from "../lib/legal/durable-ingestion-types.ts";
import { legalDocumentIngestionWorkflow } from "../workflows/legal-document-ingestion.ts";

const COMMIT_MARKER = "[live-persistent]";
const enabled = process.env.RUN_LIVE_PERSISTENT_INGESTION === "true" ||
  (process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "").includes(COMMIT_MARKER);

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

async function main() {
  if (!enabled) {
    console.log(
      `[live-persistent] skipped; add ${COMMIT_MARKER} to the commit message or set RUN_LIVE_PERSISTENT_INGESTION=true.`,
    );
    return;
  }

  process.env.LEGAL_BLOB_ACCESS ||= "private";
  process.env.LEGAL_BLOB_SOFT_LIMIT_BYTES ||= "750000000";
  process.env.LEGAL_RUN_RETENTION_DAYS ||= "30";

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

  const [state, revision, after] = await Promise.all([
    readDurableIngestionState(SOURCE_82.number),
    readDurableRevision(SOURCE_82.number),
    readDurableStoreUsage(),
  ]);
  assert.equal(state?.status, "ready");
  assert.equal(state?.stage, "completed");
  assert.equal(revision?.revisionId, result.revision?.revisionId);
  assert.equal(revision?.document.number, SOURCE_82.number);
  assert.equal(revision?.validation.accepted, true);

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
  }));
  console.log("[live-persistent] private Blob ingestion passed");
}

main().catch((error) => {
  console.error("[live-persistent] failed", error);
  process.exitCode = 1;
});
