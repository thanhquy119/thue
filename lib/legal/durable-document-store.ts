import { get, put, type PutBlobResult } from "@vercel/blob";
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

function blobAccess(): "public" | "private" {
  return process.env.LEGAL_BLOB_ACCESS === "private" ? "private" : "public";
}

function basePath(number: string) {
  return `legal-documents/${documentStorageKey(number)}`;
}

export function durableStoreConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export function durableStoreAccess() {
  return blobAccess();
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

export async function writeDurableOcrPage(number: string, runId: string, page: DurableOcrPage) {
  const padded = String(page.page).padStart(5, "0");
  return writeJson(`${basePath(number)}/runs/${runId}/pages/${padded}.json`, page, true);
}

export async function readDurableOcrPage(number: string, runId: string, page: number) {
  const padded = String(page).padStart(5, "0");
  return readJson<DurableOcrPage>(`${basePath(number)}/runs/${runId}/pages/${padded}.json`);
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
  try {
    return await put(`${basePath(number)}/sources/${sha256}.${safeExtension}`, body, {
      access: blobAccess(),
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 31_536_000,
      contentType,
      multipart: body.byteLength >= 5_000_000,
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

export async function publishDurableRevision(revision: DurablePublishedRevision) {
  const immutablePath = `${basePath(revision.document.number)}/revisions/${revision.revisionId}.json`;
  try {
    await writeJson(immutablePath, revision, false);
  } catch (error) {
    const existing = await readJson<DurablePublishedRevision>(immutablePath);
    if (!existing) throw error;
  }
  return writeJson(`${basePath(revision.document.number)}/current.json`, revision, true);
}
