import {createHash, createHmac} from "node:crypto";
import {r2Configured} from "@/lib/storage/r2-blob-compat";

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function config() {
  const endpoint = process.env.R2_ENDPOINT?.trim().replace(/\/+$/u, "");
  const bucket = process.env.R2_BUCKET?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.R2_REGION?.trim() || "auto",
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL?.trim().replace(/\/+$/u, "") || "",
  };
}

export function legalVideoR2Configured() {
  return r2Configured() && Boolean(config());
}

function encodePath(pathname: string) {
  return pathname
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/gu, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function signingKey(secret: string, date: string, region: string) {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function canonicalQuery(entries: Array<[string, string]>) {
  return entries
    .map(([key, value]) => [encodeURIComponent(key), encodeURIComponent(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function presignedR2Url(pathname: string, expiresSeconds: number) {
  const current = config();
  if (!current) throw new Error("R2 chưa được cấu hình đầy đủ cho media video.");
  const encodedObjectPath = encodePath(pathname);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/gu, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${current.region}/s3/aws4_request`;
  const endpoint = new URL(current.endpoint);
  const canonicalUri = `/${encodePath(current.bucket)}/${encodedObjectPath}`;
  const expires = String(Math.max(60, Math.min(604_800, Math.round(expiresSeconds))));
  const queryEntries: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${current.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", expires],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const query = canonicalQuery(queryEntries);
  const canonicalRequest = [
    "GET",
    canonicalUri,
    query,
    `host:${endpoint.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join("\n");
  const signature = createHmac("sha256", signingKey(current.secretAccessKey, dateStamp, current.region))
    .update(stringToSign)
    .digest("hex");
  return `${current.endpoint}${canonicalUri}?${query}&X-Amz-Signature=${signature}`;
}

export function signedR2MediaUrl(pathname: string, expiresSeconds = 21_600) {
  const current = config();
  if (!current) throw new Error("R2 chưa được cấu hình đầy đủ cho media video.");
  if (current.publicBaseUrl) return `${current.publicBaseUrl}/${encodePath(pathname)}`;
  return presignedR2Url(pathname, expiresSeconds);
}

export async function readR2Object(pathname: string) {
  const response = await fetch(presignedR2Url(pathname, 300), {cache: "no-store"});
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`R2 GET ${pathname} thất bại (${response.status})${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function r2MediaObjectExists(pathname: string) {
  const response = await fetch(presignedR2Url(pathname, 300), {
    method: "GET",
    headers: {range: "bytes=0-0"},
    cache: "no-store",
  });
  if (response.status === 404) return false;
  if (response.status === 200 || response.status === 206) {
    await response.body?.cancel().catch(() => undefined);
    return true;
  }
  const detail = await response.text().catch(() => "");
  throw new Error(`Không kiểm tra được media trên R2 (${response.status})${detail ? `: ${detail.slice(0, 160)}` : ""}`);
}

export const R2_MEDIA_CACHE_SECONDS = 31_536_000;
export const R2_MEDIA_SIGNED_URL_SECONDS = 21_600;
export {EMPTY_SHA256};
