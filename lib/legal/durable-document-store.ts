import { del, get, list, put, type PutBlobResult } from "@vercel/blob";
import type { DocumentDetail } from "./types.ts";
import {
  documentStorageKey,
  type DurableIngestionState,
  type DurableOcrPage,
  type DurableValidationResult,
} from "./durable-ingestion-types.ts";

export type DurablePublishedRevision = {
  revisionId: string;
  sourceSha256: string;
  sourceBlobUrl: string | null;
  document: DocumentDetail;
  validation: DurableValidationResult;
  publishedAt: string;
};

export type DurableStoreUsage = {
  bytes: number;
  objects: number;
};

export type DurableCleanupResult = {
  deletedObjects: number;
  deletedBytes: number;
};

function blobAccess(): "public" | "private" {
  return process.env.LEGAL_BLOB_ACCESS === "private" ? "private" : "public";
}

function basePath(number: string) {
  return `legal-documents/${documentStorageKey(number)}`;
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function durableStoreConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export function durableStoreAccess() {
  return blobAccess();
}

export function durableStoreSoftLimitBytes() {
  return positiveNumber(process.env.LEGAL_BLOB_SOFT_LIMIT_BYTES, 750_000_000);
}

export function durableRunRetentionDays() {
  return positiveNumber(process.env.LEGAL_RUN_RETENTION_DAYS, 30);
}

async function streamText(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return "";
  return new Response(stream).text();
}

async function readJson<T>(pathname: string): Promise<T | null> {
  if (!durableStoreConfigured()) return null;
  const result = await get(pathname, { access: blobAccess() });
  if (!result || result.statusCode !== 200) return null;
  const value = await streamText(result.stream);
  if (!value) return null;
  return JSON.parse(value) as T;
}

async function writeJson(pathname: string, value: unknown, mutable: boolean) {
  if (!durableStoreConfigured()) {
    throw new Error("Chưa có BLOB_READ_WRITE_TOKEN cho kho nhập văn bản bền vững.");
  }
  return put(pathname, JSON.stringify(value), {
    access: blobAccess(),
    allowOverwrite: mutable,
    addRandomSuffix: false,
    cacheControlMaxAge: mutable ? 60 : 31_536_000,
    contentType: "application/json; charset=utf-8",
  });
}

async function listAll(prefix?: string) {
  const blobs: Awaited<ReturnType<typeof list>>["blobs"] = [];
  let cursor: string | undefined;
  do {
    const result = await list({ prefix, cursor, limit: 1000 });
    blobs.push(...result.blobs);
    cursor = result.cursor;
  } while (cursor);
  return blobs;
}

async function deleteBlobs(blobs: Awaited<ReturnType<typeof list>>["blobs"]): Promise<DurableCleanupResult> {
  let deletedObjects = 0;
  let deletedBytes = 0;
  for (let index = 0; index < blobs.length; index += 100) {
    const batch = blobs.slice(index, index + 100);
    if (!batch.length) continue;
    await del(batch.map((blob) => blob.url));
    deletedObjects += batch.length;
    deletedBytes += batch.reduce((sum, blob) => sum + blob.size, 0);
  }
  return { deletedObjects, deletedBytes };
}

export async function readDurableStoreUsage(): Promise<DurableStoreUsage> {
  if (!durableStoreConfigured()) return { bytes: 0, objects: 0 };
  const blobs = await listAll("legal-documents/");
  return {
    bytes: blobs.reduce((sum, blob) => sum + blob.size, 0),
    objects: blobs.length,
  };
}

export async function cleanupExpiredDurableRunCheckpoints(
  maxAgeDays = durableRunRetentionDays(),
): Promise<DurableCleanupResult> {
  if (!durableStoreConfigured()) return { deletedObjects: 0, deletedBytes: 0 };
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const blobs = await listAll("legal-documents/");
  const expired = blobs.filter((blob) => {
    if (!blob.pathname.includes("/runs/")) return false;
    const uploadedAt = Date.parse(String(blob.uploadedAt));
    return Number.isFinite(uploadedAt) && uploadedAt < cutoff;
  });
  return deleteBlobs(expired);
}

export async function ensureDurableStoreCapacity(incomingBytes = 0) {
  const softLimitBytes = durableStoreSoftLimitBytes();
  let usage = await readDurableStoreUsage();
  if (usage.bytes + incomingBytes <= softLimitBytes) return { usage, softLimitBytes, cleaned: null };

  const cleaned = await cleanupExpiredDurableRunCheckpoints();
  usage = await readDurableStoreUsage();
  if (usage.bytes + incomingBytes > softLimitBytes) {
    throw new Error(
      `Kho Blob đã chạm ngưỡng an toàn ${softLimitBytes} byte; tạm dừng nhập mới để giữ dự án trong hạn mức miễn phí.`,
    );
  }
  return { usage, softLimitBytes, cleaned };
}

export async function verifyDurableStore() {
  if (!durableStoreConfigured()) {
    return {
      ok: false,
      configured: false,
      access: blobAccess(),
      error: "BLOB_READ_WRITE_TOKEN chưa được cấu hình.",
    };
  }
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const pathname = `legal-documents/_health/storage-check-${nonce}.json`;
  let attempts = 0;
  try {
    await writeJson(pathname, { nonce, checkedAt: new Date().toISOString() }, false);

    let value: { nonce?: string } | null = null;
    const retryDelays = [0, 120, 300, 700, 1_400];
    for (const delay of retryDelays) {
      if (delay) await sleep(delay);
      attempts += 1;
      value = await readJson<{ nonce?: string }>(pathname);
      if (value?.nonce === nonce) break;
    }

    return {
      ok: value?.nonce === nonce,
      configured: true,
      access: blobAccess(),
      softLimitBytes: durableStoreSoftLimitBytes(),
      retentionDays: durableRunRetentionDays(),
      attempts,
      error: value?.nonce === nonce ? null : "Không đọc lại được giá trị vừa ghi sau các lần thử có giới hạn.",
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      access: blobAccess(),
      attempts,
      error: error instanceof Error ? error.message : "Kiểm tra Blob thất bại.",
    };
  } finally {
    await del(pathname).catch(() => undefined);
  }
}

export async function readDurableIngestionState(number: string) {
  return readJson<DurableIngestionState>(`${basePath(number)}/status.json`);
}

export async function writeDurableIngestionState(state: DurableIngestionState) {
  return writeJson(`${basePath(state.number)}/status.json`, state, true);
}

export async function readDurableDocument(number: string) {
  const revision = await readJson<DurablePublishedRevision>(`${basePath(number)}/current.json`);
  return revision?.document ?? null;
}

export async function readDurableRevision(number: string) {
  return readJson<DurablePublishedRevision>(`${basePath(number)}/current.json`);
}

export async function readPreviousDurableRevision(number: string) {
  return readJson<DurablePublishedRevision>(`${basePath(number)}/previous.json`);
}

export async function writeDurableOcrPage(number: string, runId: string, page: DurableOcrPage) {
  const padded = String(page.page).padStart(5, "0");
  return writeJson(`${basePath(number)}/runs/${runId}/pages/${padded}.json`, page, true);
}

export async function readDurableOcrPage(number: string, runId: string, page: number) {
  const padded = String(page).padStart(5, "0");
  return readJson<DurableOcrPage>(`${basePath(number)}/runs/${runId}/pages/${padded}.json`);
}

export async function cleanupDurableRun(number: string, runId: string) {
  if (!durableStoreConfigured()) return { deletedObjects: 0, deletedBytes: 0 };
  const blobs = await listAll(`${basePath(number)}/runs/${runId}/`);
  return deleteBlobs(blobs);
}

export async function writeDurableSource(
  number: string,
  sha256: string,
  extension: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<PutBlobResult> {
  if (!durableStoreConfigured()) {
    throw new Error("Chưa có BLOB_READ_WRITE_TOKEN cho kho nhập văn bản bền vững.");
  }
  const safeExtension = extension.replace(/[^a-z0-9]/giu, "").toLocaleLowerCase("en") || "bin";
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  await ensureDurableStoreCapacity(payload.byteLength);
  try {
    return await put(`${basePath(number)}/sources/${sha256}.${safeExtension}`, payload, {
      access: blobAccess(),
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 31_536_000,
      contentType,
      multipart: payload.byteLength >= 5_000_000,
    });
  } catch (error) {
    const existing = await get(`${basePath(number)}/sources/${sha256}.${safeExtension}`, {
      access: blobAccess(),
    });
    if (existing?.statusCode === 200) {
      return {
        url: existing.blob.url,
        downloadUrl: existing.blob.downloadUrl,
        pathname: existing.blob.pathname,
        contentType: existing.blob.contentType ?? contentType,
        contentDisposition: existing.blob.contentDisposition,
        etag: existing.blob.etag,
      };
    }
    throw error;
  }
}

async function pruneDurableSources(number: string, keepUrls: Array<string | null | undefined>) {
  const keep = new Set(keepUrls.filter((value): value is string => Boolean(value)));
  const blobs = await listAll(`${basePath(number)}/sources/`);
  return deleteBlobs(blobs.filter((blob) => !keep.has(blob.url)));
}

async function cleanupLegacyRevisions(number: string) {
  const blobs = await listAll(`${basePath(number)}/revisions/`);
  return deleteBlobs(blobs);
}

export async function publishDurableRevision(revision: DurablePublishedRevision) {
  const currentPath = `${basePath(revision.document.number)}/current.json`;
  const previousPath = `${basePath(revision.document.number)}/previous.json`;
  const existing = await readJson<DurablePublishedRevision>(currentPath);

  if (existing && existing.revisionId !== revision.revisionId) {
    await writeJson(previousPath, existing, true);
  }
  const published = await writeJson(currentPath, revision, true);
  const previous = await readJson<DurablePublishedRevision>(previousPath);
  await pruneDurableSources(revision.document.number, [revision.sourceBlobUrl, previous?.sourceBlobUrl]);
  await cleanupLegacyRevisions(revision.document.number);
  return published;
}
