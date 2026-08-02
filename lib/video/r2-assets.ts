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

function storageTimeoutMs() {
  const configured = Number(process.env.VIDEO_R2_TTS_TIMEOUT_MS || 45_000);
  return Number.isFinite(configured) ? Math.max(10_000, Math.min(90_000, configured)) : 45_000;
}

async function withTimeout<T>(promise: Promise<T>, label: string, milliseconds = storageTimeoutMs()) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} quá thời gian.`)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  const value = await withTimeout(
    readR2Object(metadataPath(cacheKey)),
    "Đọc metadata cache TTS trên R2",
    Math.min(25_000, storageTimeoutMs()),
  );
  if (!value?.byteLength) return null;
  const text = decoder.decode(value);
  if (!text.trim()) return null;
  return JSON.parse(text) as TtsMetadata;
}

export async function readCachedTtsAsset(cacheKey: string) {
  if (!videoMediaConfigured()) throw new Error("R2 chưa được cấu hình cho audio video.");
  try {
    const metadata = await readMetadata(cacheKey);
    const pathname = metadata?.pathname || metadata?.cacheKey;
    if (!metadata || metadata.cacheKey !== cacheKey || metadata.durationSeconds <= 0 || !pathname) return null;
    const exists = await withTimeout(
      r2MediaObjectExists(pathname),
      "Kiểm tra cache TTS trên R2",
      Math.min(25_000, storageTimeoutMs()),
    );
    if (!exists) return null;
    return {
      cacheKey,
      durationSeconds: metadata.durationSeconds,
      url: await signedR2MediaUrl(pathname, R2_MEDIA_SIGNED_URL_SECONDS),
      cached: true,
    };
  } catch {
    // Cache chỉ là tối ưu. Nếu R2 đọc tạm thời chậm, Workflow vẫn có thể gọi Azure
    // rồi ghi lại cùng một khóa nội dung mà không làm hỏng toàn bộ job.
    return null;
  }
}

export async function writeTtsAsset(input: {
  key: string;
  bytes: Uint8Array;
  durationSeconds: number;
  voice: string;
}) {
  if (!videoMediaConfigured()) throw new Error("R2 chưa được cấu hình cho audio video.");
  await withTimeout(
    put(input.key, input.bytes, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: R2_MEDIA_CACHE_SECONDS,
      contentType: "audio/wav",
    }),
    "Ghi WAV TTS lên R2",
  );
  const metadata: TtsMetadata = {
    cacheKey: input.key,
    pathname: input.key,
    durationSeconds: input.durationSeconds,
    voice: input.voice,
    createdAt: new Date().toISOString(),
  };
  await withTimeout(
    put(metadataPath(input.key), encoder.encode(JSON.stringify(metadata)), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
      contentType: "application/json; charset=utf-8",
    }),
    "Ghi metadata TTS lên R2",
  );
  return {
    cacheKey: input.key,
    durationSeconds: input.durationSeconds,
    url: await signedR2MediaUrl(input.key, R2_MEDIA_SIGNED_URL_SECONDS),
    cached: false,
  };
}
