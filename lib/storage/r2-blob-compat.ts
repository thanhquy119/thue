import {
  del as blobDel,
  get as blobGet,
  list as blobList,
  put as blobPut,
  type PutBlobResult,
} from "@vercel/blob";

export type { PutBlobResult } from "@vercel/blob";

type PutOptions = {
  access?: "public" | "private";
  allowOverwrite?: boolean;
  addRandomSuffix?: boolean;
  cacheControlMaxAge?: number;
  contentType?: string;
  multipart?: boolean;
};

type GetOptions = {
  access?: "public" | "private";
  useCache?: boolean;
};

type ListOptions = {
  prefix?: string;
  cursor?: string;
  limit?: number;
};

type ListedObject = {
  url: string;
  downloadUrl: string;
  pathname: string;
  size: number;
  uploadedAt: Date;
};

type ListResult = {
  blobs: ListedObject[];
  cursor?: string;
};

type R2Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const TOMBSTONE_PREFIX = "_storage-tombstones/";
const encoder = new TextEncoder();

function r2Config(): R2Config | null {
  const endpoint = process.env.R2_ENDPOINT?.trim().replace(/\/+$/u, "");
  const bucket = process.env.R2_BUCKET?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint,
    bucket,
    region: process.env.R2_REGION?.trim() || "auto",
    accessKeyId,
    secretAccessKey,
  };
}

export function r2Configured() {
  return Boolean(r2Config());
}

export function blobFallbackConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export function storageConfigured() {
  return r2Configured() || blobFallbackConfigured();
}

export function storageBackend() {
  if (r2Configured()) return "r2" as const;
  if (blobFallbackConfigured()) return "vercel-blob" as const;
  return "none" as const;
}

function encodePath(pathname: string) {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/gu, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

function bytes(value: string | Buffer | Uint8Array) {
  if (typeof value === "string") return encoder.encode(value);
  return new Uint8Array(value);
}

function arrayBuffer(value: Uint8Array) {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function hex(value: ArrayBuffer) {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string | Buffer | Uint8Array) {
  return hex(await crypto.subtle.digest("SHA-256", arrayBuffer(bytes(value))));
}

async function hmac(key: string | Uint8Array, value: string) {
  const keyBytes = typeof key === "string" ? encoder.encode(key) : key;
  const imported = await crypto.subtle.importKey(
    "raw",
    arrayBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, arrayBuffer(encoder.encode(value))));
}

async function signingKey(secret: string, date: string, region: string) {
  const dateKey = await hmac(`AWS4${secret}`, date);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, "s3");
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

async function signedR2Request(
  method: string,
  pathname: string,
  options: {
    body?: string | Buffer | Uint8Array;
    contentType?: string;
    cacheControl?: string;
    ifNoneMatch?: string;
    query?: Array<[string, string]>;
  } = {},
) {
  const config = r2Config();
  if (!config) throw new Error("R2 chưa được cấu hình đầy đủ.");

  const body = options.body === undefined ? new Uint8Array() : bytes(options.body);
  const payloadHash = body.byteLength ? await sha256(body) : EMPTY_SHA256;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/gu, "");
  const dateStamp = amzDate.slice(0, 8);
  const endpoint = new URL(config.endpoint);
  const canonicalUri = `/${encodePath(config.bucket)}${pathname ? `/${encodePath(pathname)}` : ""}`;
  const query = canonicalQuery(options.query ?? []);

  const headers = new Map<string, string>([
    ["host", endpoint.host],
    ["x-amz-content-sha256", payloadHash],
    ["x-amz-date", amzDate],
  ]);
  if (options.contentType) headers.set("content-type", options.contentType);
  if (options.cacheControl) headers.set("cache-control", options.cacheControl);
  if (options.ifNoneMatch) headers.set("if-none-match", options.ifNoneMatch);

  const sortedHeaders = [...headers.entries()].sort(([left], [right]) => left.localeCompare(right));
  const canonicalHeaders = sortedHeaders.map(([key, value]) => `${key}:${value.trim()}\n`).join("");
  const signedHeaders = sortedHeaders.map(([key]) => key).join(";");
  const canonicalRequest = [method, canonicalUri, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256(canonicalRequest),
  ].join("\n");
  const signatureBytes = await hmac(
    await signingKey(config.secretAccessKey, dateStamp, config.region),
    stringToSign,
  );
  const signature = hex(arrayBuffer(signatureBytes));
  headers.set(
    "authorization",
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  );

  const url = `${config.endpoint}${canonicalUri}${query ? `?${query}` : ""}`;
  return fetch(url, {
    method,
    headers: Object.fromEntries(headers),
    body: method === "GET" || method === "HEAD" || method === "DELETE" ? undefined : body,
    cache: "no-store",
  });
}

function r2Url(pathname: string) {
  const config = r2Config();
  return `r2://${config?.bucket ?? "bucket"}/${pathname}`;
}

async function tombstonePath(pathname: string) {
  return `${TOMBSTONE_PREFIX}${await sha256(pathname)}.json`;
}

async function hasTombstone(pathname: string) {
  if (!r2Configured()) return false;
  const response = await signedR2Request("GET", await tombstonePath(pathname));
  return response.status === 200;
}

async function writeTombstone(pathname: string) {
  if (!r2Configured()) return;
  await signedR2Request("PUT", await tombstonePath(pathname), {
    body: JSON.stringify({ pathname, deletedAt: new Date().toISOString() }),
    contentType: "application/json; charset=utf-8",
    cacheControl: "no-store",
  });
}

async function putR2(pathname: string, body: string | Buffer | Uint8Array, options: PutOptions = {}): Promise<PutBlobResult> {
  const response = await signedR2Request("PUT", pathname, {
    body,
    contentType: options.contentType,
    cacheControl: options.cacheControlMaxAge !== undefined
      ? `public, max-age=${Math.max(0, options.cacheControlMaxAge)}`
      : undefined,
    ifNoneMatch: options.allowOverwrite === false ? "*" : undefined,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`R2 PUT ${pathname} thất bại (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ""}`);
  }
  const url = r2Url(pathname);
  return {
    url,
    downloadUrl: url,
    pathname,
    contentType: options.contentType ?? "application/octet-stream",
    contentDisposition: "inline",
    etag: response.headers.get("etag") ?? await sha256(body),
  };
}

async function getR2(pathname: string) {
  const response = await signedR2Request("GET", pathname);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`R2 GET ${pathname} thất bại (${response.status}).`);
  const value = new Uint8Array(await response.arrayBuffer());
  const url = r2Url(pathname);
  return {
    statusCode: 200,
    stream: new Response(value).body,
    blob: {
      url,
      downloadUrl: url,
      pathname,
      contentType: response.headers.get("content-type") ?? undefined,
      contentDisposition: response.headers.get("content-disposition") ?? "inline",
      etag: response.headers.get("etag") ?? await sha256(value),
    },
    bytes: value,
  };
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, "&");
}

function xmlValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "u"));
  return match ? decodeXml(match[1]) : null;
}

async function listR2(options: ListOptions = {}): Promise<ListResult> {
  const query: Array<[string, string]> = [
    ["list-type", "2"],
    ["max-keys", String(Math.min(1_000, Math.max(1, options.limit ?? 1_000)))],
  ];
  if (options.prefix) query.push(["prefix", options.prefix]);
  if (options.cursor) query.push(["continuation-token", options.cursor]);
  const response = await signedR2Request("GET", "", { query });
  if (!response.ok) throw new Error(`R2 LIST thất bại (${response.status}).`);
  const xml = await response.text();
  const contents = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/gu)];
  const blobs = contents.flatMap((match) => {
    const key = xmlValue(match[1], "Key");
    if (!key) return [];
    const size = Number(xmlValue(match[1], "Size") ?? 0);
    const uploadedAt = new Date(xmlValue(match[1], "LastModified") ?? 0);
    return [{
      url: r2Url(key),
      downloadUrl: r2Url(key),
      pathname: key,
      size: Number.isFinite(size) ? size : 0,
      uploadedAt,
    }];
  });
  return { blobs, cursor: xmlValue(xml, "NextContinuationToken") ?? undefined };
}

async function migrateBlobObject(pathname: string, access: "public" | "private") {
  const legacy = await blobGet(pathname, access === "private"
    ? { access: "private", useCache: false }
    : { access: "public" });
  if (!legacy || legacy.statusCode !== 200 || !legacy.stream) return null;
  const value = new Uint8Array(await new Response(legacy.stream).arrayBuffer());
  await putR2(pathname, value, {
    allowOverwrite: false,
    contentType: legacy.blob.contentType ?? "application/octet-stream",
  }).catch(async (error) => {
    const existing = await getR2(pathname);
    if (!existing) throw error;
  });
  return getR2(pathname);
}

export async function get(pathname: string, options: GetOptions = {}) {
  if (!r2Configured()) return blobGet(pathname, options as Parameters<typeof blobGet>[1]);
  if (await hasTombstone(pathname)) return null;
  const primary = await getR2(pathname);
  if (primary) {
    const { bytes: _bytes, ...result } = primary;
    return result;
  }
  if (!blobFallbackConfigured()) return null;
  const migrated = await migrateBlobObject(pathname, options.access ?? "private");
  if (!migrated) return null;
  const { bytes: _bytes, ...result } = migrated;
  return result;
}

export async function put(
  pathname: string,
  body: string | Buffer | Uint8Array,
  options: PutOptions = {},
): Promise<PutBlobResult> {
  if (r2Configured()) return putR2(pathname, body, options);
  return blobPut(pathname, body, options as Parameters<typeof blobPut>[2]);
}

function pathnameFromReference(value: string) {
  if (value.startsWith("r2://")) {
    const withoutScheme = value.slice("r2://".length);
    return withoutScheme.slice(withoutScheme.indexOf("/") + 1);
  }
  if (/^https?:\/\//iu.test(value)) {
    const url = new URL(value);
    return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  }
  return value.replace(/^\/+/, "");
}

export async function del(values: string | string[]) {
  if (!r2Configured()) return blobDel(values);
  const pathnames = (Array.isArray(values) ? values : [values]).map(pathnameFromReference);
  for (const pathname of pathnames) {
    const response = await signedR2Request("DELETE", pathname);
    if (!response.ok && response.status !== 404) {
      throw new Error(`R2 DELETE ${pathname} thất bại (${response.status}).`);
    }
    await writeTombstone(pathname);
  }
}

async function tombstonedPathHashes() {
  const hashes = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await listR2({ prefix: TOMBSTONE_PREFIX, cursor, limit: 1_000 });
    for (const blob of page.blobs) {
      const hash = blob.pathname.slice(TOMBSTONE_PREFIX.length).replace(/\.json$/u, "");
      if (hash) hashes.add(hash);
    }
    cursor = page.cursor;
  } while (cursor);
  return hashes;
}

export async function list(options: ListOptions = {}): Promise<ListResult> {
  if (!r2Configured()) return blobList(options) as Promise<ListResult>;
  const primary = await listR2(options);

  // Exact reads migrate old documents lazily. Broad legal-document Blob listings are
  // intentionally avoided so the remaining Vercel advanced-request quota is preserved.
  if (!options.prefix?.startsWith("legal-notifications/") || !blobFallbackConfigured()) return primary;

  const legacy = await blobList(options);
  const tombstones = await tombstonedPathHashes();
  const byPath = new Map(primary.blobs.map((blob) => [blob.pathname, blob]));
  for (const blob of legacy.blobs) {
    if (tombstones.has(await sha256(blob.pathname)) || byPath.has(blob.pathname)) continue;
    byPath.set(blob.pathname, {
      url: blob.url,
      downloadUrl: blob.downloadUrl,
      pathname: blob.pathname,
      size: blob.size,
      uploadedAt: new Date(blob.uploadedAt),
    });
  }
  return { blobs: [...byPath.values()], cursor: primary.cursor };
}
