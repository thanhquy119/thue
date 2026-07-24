import { del, get, list, put } from "@vercel/blob";
import {
  pushSubscriptionId,
  type BrowserPushSubscription,
  type StoredPushSubscription,
} from "./push-core.ts";

export type StoredVapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
  createdAt: string;
};

const ROOT = "legal-notifications";
const CONFIG_PATH = `${ROOT}/config/vapid.json`;
const SUBSCRIPTION_PREFIX = `${ROOT}/subscriptions/`;
const RECEIPT_PREFIX = `${ROOT}/receipts/`;
const DISPATCH_PREFIX = `${ROOT}/dispatches/`;

function positiveInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(maximum, Math.floor(parsed));
}

export function pushStoreConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export function maximumPushSubscriptions() {
  return positiveInteger(process.env.WEB_PUSH_MAX_SUBSCRIPTIONS, 1_000, 1_000);
}

export function pushReceiptRetentionDays() {
  return positiveInteger(process.env.WEB_PUSH_RECEIPT_RETENTION_DAYS, 30, 365);
}

async function streamText(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return "";
  return new Response(stream).text();
}

async function readPrivateJson<T>(pathname: string): Promise<T | null> {
  if (!pushStoreConfigured()) return null;
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  const value = await streamText(result.stream);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function writePrivateJson(pathname: string, value: unknown, allowOverwrite: boolean) {
  if (!pushStoreConfigured()) throw new Error("Private Blob chưa được cấu hình cho Web Push.");
  return put(pathname, JSON.stringify(value), {
    access: "private",
    allowOverwrite,
    addRandomSuffix: false,
    cacheControlMaxAge: allowOverwrite ? 60 : 31_536_000,
    contentType: "application/json; charset=utf-8",
  });
}

export async function readVapidConfig() {
  return readPrivateJson<StoredVapidConfig>(CONFIG_PATH);
}

export async function createVapidConfig(config: StoredVapidConfig) {
  await writePrivateJson(CONFIG_PATH, config, false);
}

function subscriptionPath(id: string) {
  return `${SUBSCRIPTION_PREFIX}${id}.json`;
}

export async function savePushSubscription(subscription: BrowserPushSubscription) {
  const id = pushSubscriptionId(subscription.endpoint);
  const pathname = subscriptionPath(id);
  const existing = await readPrivateJson<StoredPushSubscription>(pathname);
  if (!existing) {
    const maximum = maximumPushSubscriptions();
    const current = await list({ prefix: SUBSCRIPTION_PREFIX, limit: maximum });
    if (current.blobs.length >= maximum) {
      throw new Error(`Hệ thống đã đạt giới hạn an toàn ${maximum} thiết bị nhận thông báo.`);
    }
  }

  const now = new Date().toISOString();
  const stored: StoredPushSubscription = {
    id,
    subscription,
    topics: ["new_documents"],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writePrivateJson(pathname, stored, true);
  return stored;
}

export async function deletePushSubscriptionByEndpoint(endpoint: string) {
  const id = pushSubscriptionId(endpoint);
  await del(subscriptionPath(id));
  return id;
}

export async function deletePushSubscriptionById(id: string) {
  await del(subscriptionPath(id));
}

export async function readAllPushSubscriptions() {
  if (!pushStoreConfigured()) return [] as StoredPushSubscription[];
  const result = await list({ prefix: SUBSCRIPTION_PREFIX, limit: maximumPushSubscriptions() });
  const subscriptions: StoredPushSubscription[] = [];
  for (let index = 0; index < result.blobs.length; index += 20) {
    const batch = result.blobs.slice(index, index + 20);
    const values = await Promise.all(batch.map((blob) => readPrivateJson<StoredPushSubscription>(blob.pathname)));
    subscriptions.push(...values.filter((value): value is StoredPushSubscription => Boolean(value?.subscription?.endpoint)));
  }
  return subscriptions;
}

function receiptPath(revisionId: string, subscriptionId: string) {
  return `${RECEIPT_PREFIX}${revisionId}/${subscriptionId}.json`;
}

export async function readPushDeliveryReceiptIds(revisionId: string) {
  if (!pushStoreConfigured()) return new Set<string>();
  const prefix = `${RECEIPT_PREFIX}${revisionId}/`;
  const ids = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1_000 });
    for (const blob of page.blobs) {
      const filename = blob.pathname.slice(prefix.length).replace(/\.json$/u, "");
      if (/^[a-f0-9]{64}$/u.test(filename)) ids.add(filename);
    }
    cursor = page.cursor;
  } while (cursor);
  return ids;
}

export async function writePushDeliveryReceipt(revisionId: string, subscriptionId: string) {
  await writePrivateJson(receiptPath(revisionId, subscriptionId), {
    revisionId,
    subscriptionId,
    deliveredAt: new Date().toISOString(),
  }, true);
}

function dispatchPath(revisionId: string) {
  return `${DISPATCH_PREFIX}${revisionId}.json`;
}

export async function hasPushRevisionDispatch(revisionId: string) {
  return Boolean(await readPrivateJson<{ completedAt?: string }>(dispatchPath(revisionId)));
}

export async function writePushRevisionDispatch(revisionId: string, summary: unknown) {
  await writePrivateJson(dispatchPath(revisionId), {
    revisionId,
    completedAt: new Date().toISOString(),
    summary,
  }, true);
}

export async function cleanupExpiredPushReceipts(maxAgeDays = pushReceiptRetentionDays()) {
  if (!pushStoreConfigured()) return { deletedObjects: 0, deletedBytes: 0 };
  const cutoff = Date.now() - Math.max(1, maxAgeDays) * 86_400_000;
  const expired = [] as Awaited<ReturnType<typeof list>>["blobs"];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: RECEIPT_PREFIX, cursor, limit: 1_000 });
    expired.push(...page.blobs.filter((blob) => {
      const uploadedAt = Date.parse(String(blob.uploadedAt));
      return Number.isFinite(uploadedAt) && uploadedAt < cutoff;
    }));
    cursor = page.cursor;
  } while (cursor);

  let deletedObjects = 0;
  let deletedBytes = 0;
  for (let index = 0; index < expired.length; index += 100) {
    const batch = expired.slice(index, index + 100);
    await del(batch.map((blob) => blob.url));
    deletedObjects += batch.length;
    deletedBytes += batch.reduce((sum, blob) => sum + blob.size, 0);
  }
  return { deletedObjects, deletedBytes };
}
