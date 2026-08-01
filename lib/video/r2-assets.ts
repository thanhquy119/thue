import {put} from "@/lib/storage/r2-blob-compat";
import {
  legalVideoR2Configured,
  readR2Object,
  R2_MEDIA_CACHE_SECONDS,
  R2_MEDIA_SIGNED_URL_SECONDS,
  r2MediaObjectExists,
  signedR2MediaUrl,
} from "./r2-media";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function videoMediaConfigured() {
  return legalVideoR2Configured();
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
    "azure-wav-r2-v1",
    input.voice,
    input.rate,
    input.pitch,
    input.text,
  ].join("\0"));
  return `legal-video/tts/${hash}.wav`;
}

type TtsMetadata = {
  cacheKey: string;
  pathname?: string;
  durationSeconds: number;
  voice: string;
  createdAt: string;
};

async function readMetadata(cacheKey: string) {
  const value = await readR2Object(metadataPath(cacheKey));
  if (!value?.byteLength) return null;
  const text = decoder.decode(value);
  if (!text.trim()) return null;
  return JSON.parse(text) as TtsMetadata;
}

export async function readCachedTtsAsset(cacheKey: string) {
  if (!videoMediaConfigured()) throw new Error("R2 chưa được cấu hình cho audio video.");
  const metadata = await readMetadata(cacheKey);
  const pathname = metadata?.pathname || metadata?.cacheKey;
  if (!metadata || metadata.cacheKey !== cacheKey || metadata.durationSeconds <= 0 || !pathname) return null;
  if (!(await r2MediaObjectExists(pathname))) return null;
  return {
    cacheKey,
    durationSeconds: metadata.durationSeconds,
    url: await signedR2MediaUrl(pathname, R2_MEDIA_SIGNED_URL_SECONDS),
    cached: true,
  };
}

export async function writeTtsAsset(input: {
  key: string;
  bytes: Uint8Array;
  durationSeconds: number;
  voice: string;
}) {
  if (!videoMediaConfigured()) throw new Error("R2 chưa được cấu hình cho audio video.");
  await put(input.key, input.bytes, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: R2_MEDIA_CACHE_SECONDS,
    contentType: "audio/wav",
  });
  const metadata: TtsMetadata = {
    cacheKey: input.key,
    pathname: input.key,
    durationSeconds: input.durationSeconds,
    voice: input.voice,
    createdAt: new Date().toISOString(),
  };
  await put(metadataPath(input.key), encoder.encode(JSON.stringify(metadata)), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
    contentType: "application/json; charset=utf-8",
  });
  return {
    cacheKey: input.key,
    durationSeconds: input.durationSeconds,
    url: await signedR2MediaUrl(input.key, R2_MEDIA_SIGNED_URL_SECONDS),
    cached: false,
  };
}
