import type {DocumentDetail} from "@/lib/legal/types";
import {put, storageConfigured} from "@/lib/storage/r2-blob-compat";
import {readR2Object, r2MediaObjectExists} from "./r2-media";
import type {
  LegalVideoJob,
  LegalVideoLength,
  LegalVideoPublicJob,
  LegalVideoStoryboard,
  LegalVideoVoice,
} from "./types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function jobPath(jobId: string) {
  return `legal-video/jobs/${jobId}.json`;
}

function fingerprintPath(fingerprint: string) {
  return `legal-video/fingerprints/${fingerprint}.json`;
}

function documentNumberKey(number: string) {
  return number
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/đ/giu, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
}

function documentVideoIndexPath(
  number: string,
  length: LegalVideoLength,
  voice: LegalVideoVoice,
) {
  return `legal-video/documents/${documentNumberKey(number)}/${length}-${voice}.json`;
}

export function documentSnapshotPath(fingerprint: string) {
  return `legal-video/sources/${fingerprint}.json`;
}

export function storyboardPath(jobId: string) {
  return `legal-video/storyboards/${jobId}.json`;
}

async function readJson<T>(pathname: string): Promise<T | null> {
  const value = await readR2Object(pathname);
  if (!value?.byteLength) return null;
  const text = decoder.decode(value);
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

export async function readLegalVideoJob(jobId: string): Promise<LegalVideoJob | null> {
  const job = await readJson<LegalVideoJob>(jobPath(jobId));
  if (!job || job.status === "ready" || !job.videoPath || !job.videoUrl) return job;
  if (!(await r2MediaObjectExists(job.videoPath))) return job;
  return {
    ...job,
    status: "ready",
    progress: 100,
    message: "Video tóm tắt đã sẵn sàng.",
    error: null,
  };
}

export async function writeLegalVideoJob(job: LegalVideoJob) {
  const updated = {...job, updatedAt: new Date().toISOString()};
  await writeJson(jobPath(job.jobId), updated);
  await Promise.all([
    writeJson(fingerprintPath(job.fingerprint), {
      jobId: job.jobId,
      status: updated.status,
      updatedAt: updated.updatedAt,
    }),
    writeJson(documentVideoIndexPath(job.documentNumber, job.length, job.voice), {
      jobId: job.jobId,
      documentNumber: job.documentNumber,
      length: job.length,
      voice: job.voice,
      status: updated.status,
      updatedAt: updated.updatedAt,
    }),
  ]);
  return updated;
}

export async function patchLegalVideoJob(jobId: string, patch: Partial<LegalVideoJob>) {
  const existing = await readLegalVideoJob(jobId);
  if (!existing) throw new Error(`Không tìm thấy job video ${jobId}.`);
  const updated: LegalVideoJob = {
    ...existing,
    ...patch,
    jobId: existing.jobId,
    version: 1,
  };
  if (existing.status === "ready") {
    updated.status = "ready";
    updated.progress = 100;
    updated.videoPath = existing.videoPath;
    updated.videoUrl = existing.videoUrl;
    updated.error = null;
  }
  return writeLegalVideoJob(updated);
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

export async function findLegalVideoJobForDocument(
  documentNumber: string,
  length: LegalVideoLength = "detailed",
  voice: LegalVideoVoice = "female",
) {
  const index = await readJson<{jobId?: unknown}>(documentVideoIndexPath(documentNumber, length, voice));
  if (!index || typeof index.jobId !== "string") return null;
  const job = await readLegalVideoJob(index.jobId);
  if (!job) return null;
  if (documentNumberKey(job.documentNumber) !== documentNumberKey(documentNumber)) return null;
  if (job.length !== length || job.voice !== voice) return null;
  return job;
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
    videoPath: _videoPath,
    ...publicFields
  } = job;
  return {...publicFields, storyboardReady: Boolean(internalStoryboardPath)};
}
