import {createHash} from "node:crypto";
import {HeadObjectCommand, PutObjectCommand, S3Client} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import {GetObjectCommand} from "@aws-sdk/client-s3";

function region() {
  return process.env.VIDEO_AWS_REGION?.trim() || process.env.AWS_REGION?.trim() || "";
}

function bucket() {
  return process.env.VIDEO_ASSET_BUCKET?.trim() || "";
}

export function videoAwsConfigured() {
  return Boolean(
    region() &&
    bucket() &&
    process.env.AWS_ACCESS_KEY_ID?.trim() &&
    process.env.AWS_SECRET_ACCESS_KEY?.trim(),
  );
}

function client() {
  if (!videoAwsConfigured()) throw new Error("AWS S3 cho video chưa được cấu hình.");
  return new S3Client({region: region()});
}

export function ttsCacheKey(input: {
  voice: string;
  rate: string;
  pitch: string;
  text: string;
}) {
  const hash = createHash("sha256")
    .update("azure-wav-v1")
    .update("\0")
    .update(input.voice)
    .update("\0")
    .update(input.rate)
    .update("\0")
    .update(input.pitch)
    .update("\0")
    .update(input.text)
    .digest("hex");
  return `legal-video/tts/${hash}.wav`;
}

async function exists(key: string) {
  try {
    const response = await client().send(new HeadObjectCommand({Bucket: bucket(), Key: key}));
    return {
      exists: true,
      durationSeconds: Number(response.Metadata?.durationseconds || 0),
    };
  } catch (error) {
    const status = (error as {$metadata?: {httpStatusCode?: number}})?.$metadata?.httpStatusCode;
    if (status === 404) return {exists: false, durationSeconds: 0};
    throw error;
  }
}

export async function signedVideoAssetUrl(key: string, expiresIn = 21_600) {
  return getSignedUrl(
    client(),
    new GetObjectCommand({Bucket: bucket(), Key: key}),
    {expiresIn},
  );
}

export async function readCachedTtsAsset(key: string) {
  const current = await exists(key);
  if (!current.exists || !current.durationSeconds) return null;
  return {
    cacheKey: key,
    durationSeconds: current.durationSeconds,
    url: await signedVideoAssetUrl(key),
    cached: true,
  };
}

export async function writeTtsAsset(input: {
  key: string;
  bytes: Uint8Array;
  durationSeconds: number;
  voice: string;
}) {
  await client().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: input.key,
    Body: input.bytes,
    ContentType: "audio/wav",
    CacheControl: "private, max-age=31536000, immutable",
    Metadata: {
      durationseconds: String(input.durationSeconds),
      voice: input.voice.slice(0, 120),
    },
  }));
  return {
    cacheKey: input.key,
    durationSeconds: input.durationSeconds,
    url: await signedVideoAssetUrl(input.key),
    cached: false,
  };
}
