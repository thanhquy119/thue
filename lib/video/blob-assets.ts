import {head, put as putBlob} from "@vercel/blob";
import {get as getState, put as putState} from "@/lib/storage/r2-blob-compat";

const encoder = new TextEncoder();

function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() || "";
}

export function videoBlobConfigured() {
  return Boolean(blobToken());
}

function metadataPath(cacheKey: string) {
  return `legal-video/tts-metadata/${cacheKey.replace(/[^a-z0-9._/-]+/giu, "-")}.json`;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function ttsCacheKey(input: {
  voice: string;
  rate: string;
  pitch: string;
  text: string;
}) {
  const hash = await sha256([
    "azure-wav-v1",
    input.voice,
    input.rate,
    input.pitch,
    input.text,
  ].join("\0"));
  return `legal-video/tts/${hash}.wav`;
}

type TtsMetadata = {
  cacheKey: string;
  durationSeconds: number;
  url: string;
  voice: string;
  createdAt: string;
};

async function readMetadata(cacheKey: string) {
  const value = await getState(metadataPath(cacheKey), {access: "private", useCache: false});
  if (!value?.stream) return null;
  const text = await new Response(value.stream).text();
  if (!text.trim()) return null;
  return JSON.parse(text) as TtsMetadata;
}

async function metadataBlobExists(url: string) {
  try {
    await head(url, {token: blobToken()});
    return true;
  } catch (error) {
    if (error instanceof Error && /not found|BlobNotFound/iu.test(`${error.name} ${error.message}`)) return false;
    throw error;
  }
}

export async function readCachedTtsAsset(cacheKey: string) {
  if (!videoBlobConfigured()) throw new Error("Vercel Blob chưa được cấu hình cho audio video.");
  const metadata = await readMetadata(cacheKey);
  if (!metadata || metadata.cacheKey !== cacheKey || metadata.durationSeconds <= 0 || !metadata.url) return null;
  if (!(await metadataBlobExists(metadata.url))) return null;
  return {
    cacheKey,
    durationSeconds: metadata.durationSeconds,
    url: metadata.url,
    cached: true,
  };
}

export async function writeTtsAsset(input: {
  key: string;
  bytes: Uint8Array;
  durationSeconds: number;
  voice: string;
}) {
  if (!videoBlobConfigured()) throw new Error("Vercel Blob chưa được cấu hình cho audio video.");
  const blob = await putBlob(input.key, input.bytes, {
    access: "public",
    token: blobToken(),
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 31_536_000,
    contentType: "audio/wav",
  });
  const metadata: TtsMetadata = {
    cacheKey: input.key,
    durationSeconds: input.durationSeconds,
    url: blob.url,
    voice: input.voice,
    createdAt: new Date().toISOString(),
  };
  await putState(metadataPath(input.key), encoder.encode(JSON.stringify(metadata)), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
    contentType: "application/json; charset=utf-8",
  });
  return {
    cacheKey: input.key,
    durationSeconds: input.durationSeconds,
    url: blob.url,
    cached: false,
  };
}
