import type {DocumentDetail} from "@/lib/legal/types";
import {get, put, storageConfigured} from "@/lib/storage/r2-blob-compat";
import type {
  LegalVideoJob,
  LegalVideoPublicJob,
  LegalVideoStoryboard,
} from "./types";

const encoder = new TextEncoder();

function jobPath(jobId: string) {
  return `legal-video/jobs/${jobId}.json`;
}

function fingerprintPath(fingerprint: string) {
  return `legal-video/fingerprints/${fingerprint}.json`;
}

export function documentSnapshotPath(fingerprint: string) {
  return `legal-video/sources/${fingerprint}.json`;
}

export function storyboardPath(jobId: string) {
  return `legal-video/storyboards/${jobId}.json`;
}

async function readJson<T>(pathname: string): Promise<T | null> {
  const value = await get(pathname, {access: "private", useCache: false});
  if (!value?.stream) return null;
  const text = await new Response(value.stream).text();
  if (!text.trim()) return null;
  return JSON.parse(text) as T;
}

async function writeJson(pathname: string, value: unknown) {
  await put(pathname, encoder.encode(JSON.stringify(value)), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    cacheControlMaxAge: 0,
    contentType: "application/json; charset=utf-8",
  });
}

export function legalVideoStoreConfigured() {
  return storageConfigured();
}

export async function readLegalVideoJob(jobId: string) {
  return readJson<LegalVideoJob>(jobPath(jobId));
}

export async function writeLegalVideoJob(job: LegalVideoJob) {
  const updated = {...job, updatedAt: new Date().toISOString()};
  await writeJson(jobPath(job.jobId), updated);
  await writeJson(fingerprintPath(job.fingerprint), {
    jobId: job.jobId,
    status: job.status,
    updatedAt: updated.updatedAt,
  });
  return updated;
}

export async function patchLegalVideoJob(jobId: string, patch: Partial<LegalVideoJob>) {
  const existing = await readLegalVideoJob(jobId);
  if (!existing) throw new Error(`Không tìm thấy job video ${jobId}.`);
  return writeLegalVideoJob({...existing, ...patch, jobId: existing.jobId, version: 1});
}

export async function findReusableLegalVideoJob(fingerprint: string) {
  const index = await readJson<{jobId?: unknown}>(fingerprintPath(fingerprint));
  if (!index || typeof index.jobId !== "string") return null;
  const job = await readLegalVideoJob(index.jobId);
  if (!job || job.fingerprint !== fingerprint) return null;
  return ["queued", "summarizing", "synthesizing", "rendering", "ready"].includes(job.status)
    ? job
    : null;
}

export async function writeLegalVideoDocument(pathname: string, document: DocumentDetail) {
  await writeJson(pathname, document);
}

export async function readLegalVideoDocument(pathname: string) {
  return readJson<DocumentDetail>(pathname);
}

export async function writeLegalVideoStoryboard(pathname: string, storyboard: LegalVideoStoryboard) {
  await writeJson(pathname, storyboard);
}

export async function readLegalVideoStoryboard(pathname: string) {
  return readJson<LegalVideoStoryboard>(pathname);
}

export function publicLegalVideoJob(job: LegalVideoJob): LegalVideoPublicJob {
  const {
    fingerprint: _fingerprint,
    documentSnapshotPath: _documentSnapshotPath,
    storyboardPath: internalStoryboardPath,
    renderSandboxId: _renderSandboxId,
    renderCommandId: _renderCommandId,
    ...publicFields
  } = job;
  return {...publicFields, storyboardReady: Boolean(internalStoryboardPath)};
}
