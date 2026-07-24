import webPush from "web-push";
import {
  expiredPushSubscriptionError,
  publishedDocumentPayload,
  shouldNotifyPublishedDocument,
  type PublishedDocumentNotification,
  type StoredPushSubscription,
} from "./push-core.ts";
import {
  createVapidConfig,
  deletePushSubscriptionById,
  readPushDeliveryReceiptIds,
  hasPushRevisionDispatch,
  pushStoreConfigured,
  readAllPushSubscriptions,
  readVapidConfig,
  writePushDeliveryReceipt,
  writePushRevisionDispatch,
  type StoredVapidConfig,
} from "./push-store.ts";

let cachedConfig: StoredVapidConfig | null = null;

function validSubject(value: string | null | undefined) {
  if (!value?.trim()) return null;
  const clean = value.trim();
  if (clean.startsWith("mailto:") && clean.length > 7) return clean;
  try {
    const url = new URL(clean);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function configuredDocumentAgeDays() {
  const parsed = Number(process.env.WEB_PUSH_MAX_DOCUMENT_AGE_DAYS ?? 60);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(365, Math.floor(parsed)) : 60;
}

function deliveryLimit() {
  const parsed = Number(process.env.WEB_PUSH_MAX_DELIVERIES_PER_RUN ?? 40);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(100, Math.floor(parsed)) : 40;
}

export async function ensureVapidConfig(_origin?: string) {
  if (!pushStoreConfigured()) return null;
  if (cachedConfig) return cachedConfig;

  const existing = await readVapidConfig();
  if (existing?.publicKey && existing.privateKey && validSubject(existing.subject)) {
    cachedConfig = existing;
    return existing;
  }

  const generated = webPush.generateVAPIDKeys();
  const config: StoredVapidConfig = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject:
      validSubject(process.env.WEB_PUSH_SUBJECT) ??
      "https://thue-ro.vercel.app",
    createdAt: new Date().toISOString(),
  };

  try {
    await createVapidConfig(config);
    cachedConfig = config;
    return config;
  } catch {
    const winner = await readVapidConfig();
    if (!winner?.publicKey || !winner.privateKey || !validSubject(winner.subject)) throw new Error("Không khởi tạo được khóa Web Push.");
    cachedConfig = winner;
    return winner;
  }
}

function vapidDetails(config: StoredVapidConfig) {
  return {
    subject: validSubject(process.env.WEB_PUSH_SUBJECT) ?? config.subject,
    publicKey: config.publicKey,
    privateKey: config.privateKey,
  };
}

async function sendToSubscription(
  stored: StoredPushSubscription,
  payload: string,
  config: StoredVapidConfig,
  topic: string,
) {
  return webPush.sendNotification(stored.subscription, payload, {
    timeout: 5_000,
    TTL: 7 * 24 * 60 * 60,
    urgency: "normal",
    topic: topic.slice(0, 32),
    vapidDetails: vapidDetails(config),
  });
}

export async function sendWelcomeNotification(stored: StoredPushSubscription, origin?: string) {
  const config = await ensureVapidConfig(origin);
  if (!config) return { sent: false, reason: "not_configured" as const };
  const payload = JSON.stringify({
    title: "Đã bật thông báo Thuế",
    body: "Thuế sẽ báo khi một văn bản mới có toàn văn chính thức và đã vượt kiểm tra chất lượng.",
    tag: "thue-notifications-enabled",
    url: "/?source=notification-welcome",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
  });
  try {
    await sendToSubscription(stored, payload, config, "welcome");
    return { sent: true, reason: null };
  } catch (error) {
    if (expiredPushSubscriptionError(error)) await deletePushSubscriptionById(stored.id).catch(() => undefined);
    return {
      sent: false,
      reason: error instanceof Error ? error.message : "Không gửi được thông báo thử.",
    };
  }
}

export async function dispatchPublishedDocumentNotifications(input: PublishedDocumentNotification) {
  if (await hasPushRevisionDispatch(input.revisionId)) {
    return { eligible: true, alreadyDispatched: true, subscribers: 0, pending: 0, sent: 0, skipped: 0, expired: 0, failed: 0 };
  }
  if (!shouldNotifyPublishedDocument(input, Date.now(), configuredDocumentAgeDays())) {
    return { eligible: false, alreadyDispatched: false, subscribers: 0, pending: 0, sent: 0, skipped: 0, expired: 0, failed: 0 };
  }

  const config = await ensureVapidConfig();
  if (!config) {
    return { eligible: true, alreadyDispatched: false, subscribers: 0, pending: 0, sent: 0, skipped: 0, expired: 0, failed: 0 };
  }
  if (Date.parse(input.publishedAt) < Date.parse(config.createdAt)) {
    const summary = { eligible: false, alreadyDispatched: false, subscribers: 0, pending: 0, sent: 0, skipped: 0, expired: 0, failed: 0 };
    await writePushRevisionDispatch(input.revisionId, { ...summary, reason: "before_push_rollout" });
    return summary;
  }

  const subscriptions = await readAllPushSubscriptions();
  const delivered = await readPushDeliveryReceiptIds(input.revisionId);
  const publishedAt = Date.parse(input.publishedAt);
  const eligibleSubscriptions = subscriptions.filter((stored) => Date.parse(stored.createdAt) <= publishedAt);
  const alreadyDelivered = eligibleSubscriptions.filter((stored) => delivered.has(stored.id)).length;
  const pending = eligibleSubscriptions.filter((stored) => !delivered.has(stored.id));
  const batch = pending.slice(0, deliveryLimit());
  const payload = JSON.stringify(publishedDocumentPayload(input));
  const summary = {
    eligible: true,
    alreadyDispatched: false,
    subscribers: subscriptions.length,
    pending: pending.length,
    sent: 0,
    skipped: subscriptions.length - eligibleSubscriptions.length + alreadyDelivered,
    expired: 0,
    failed: 0,
  };

  for (let index = 0; index < batch.length; index += 10) {
    const group = batch.slice(index, index + 10);
    const results = await Promise.all(group.map(async (stored) => {
      try {
        await sendToSubscription(stored, payload, config, input.revisionId);
        await writePushDeliveryReceipt(input.revisionId, stored.id);
        return "sent" as const;
      } catch (error) {
        if (expiredPushSubscriptionError(error)) {
          await deletePushSubscriptionById(stored.id).catch(() => undefined);
          return "expired" as const;
        }
        console.warn("[web-push-delivery-failed]", JSON.stringify({
          revisionId: input.revisionId,
          number: input.number,
          subscriptionId: stored.id,
          error: error instanceof Error ? error.message : "Web Push thất bại.",
        }));
        return "failed" as const;
      }
    }));
    for (const result of results) summary[result] += 1;
  }

  const remaining = Math.max(0, pending.length - summary.sent - summary.expired);
  summary.pending = remaining;
  if (remaining === 0 && summary.failed === 0) await writePushRevisionDispatch(input.revisionId, summary);
  return summary;
}
