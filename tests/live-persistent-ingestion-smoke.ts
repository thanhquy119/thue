import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
const commitMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "";
const revalidate94Enabled =
  process.env.RUN_LIVE_OCR_REVALIDATION === "true" || commitMessage.includes(REVALIDATE_94_MARKER);
const persistentEnabled =
  process.env.RUN_LIVE_PERSISTENT_INGESTION === "true" || commitMessage.includes(PERSISTENT_MARKER);

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
  if (revalidate94Enabled) {
    await revalidateOcr94();
    return;
  }
  if (persistentEnabled) {
    await verifyPersistent82();
    return;
  }
  console.log(
    `[live-persistent] skipped; add ${PERSISTENT_MARKER} or ${REVALIDATE_94_MARKER} to the commit message, or set the matching live-smoke environment variable.`,
  );
}

main().catch((error) => {
  console.error(revalidate94Enabled ? "[live-revalidate-94] failed" : "[live-persistent] failed", error);
  process.exitCode = 1;
});
