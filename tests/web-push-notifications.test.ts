import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  NOTIFICATION_HISTORY_RETENTION_DAYS,
  pruneNotificationHistory,
  type NotificationHistoryItem,
} from "../lib/notifications/history-core.ts";
import {
  expiredPushSubscriptionError,
  normalizePushSubscription,
  publishedDocumentPayload,
  pushSubscriptionId,
  requestOriginAllowed,
  shouldNotifyPublishedDocument,
  type PublishedDocumentNotification,
} from "../lib/notifications/push-core.ts";

const VALID_SUBSCRIPTION = {
  endpoint: "https://fcm.googleapis.com/fcm/send/example-device-token",
  expirationTime: null,
  keys: {
    p256dh: "A".repeat(87),
    auth: "b".repeat(22),
  },
};

function revision(patch: Partial<PublishedDocumentNotification> = {}): PublishedDocumentNotification {
  return {
    revisionId: "a".repeat(64),
    number: "254/2026/NĐ-CP",
    title: "Quy định về hóa đơn điện tử và chứng từ điện tử",
    issuedDate: "2026-07-01",
    publishedAt: "2026-07-24T08:00:00.000Z",
    accepted: true,
    ...patch,
  };
}

function historyItem(id: string, receivedAt: number): NotificationHistoryItem {
  return {
    id,
    title: "Văn bản thuế mới",
    body: "254/2026/NĐ-CP",
    url: "/?document=254%2F2026%2FN%C4%90-CP",
    number: "254/2026/NĐ-CP",
    revisionId: id,
    receivedAt,
  };
}

test("normalizes a secure browser push subscription", () => {
  const normalized = normalizePushSubscription(VALID_SUBSCRIPTION);
  assert.ok(normalized);
  assert.equal(normalized.endpoint, VALID_SUBSCRIPTION.endpoint);
  assert.equal(normalized.keys.p256dh, VALID_SUBSCRIPTION.keys.p256dh);
  assert.equal(normalized.expirationTime, null);
});

test("rejects insecure endpoints and malformed push keys", () => {
  assert.equal(normalizePushSubscription({ ...VALID_SUBSCRIPTION, endpoint: "http://example.com/push" }), null);
  assert.equal(normalizePushSubscription({ ...VALID_SUBSCRIPTION, endpoint: "https://attacker.example/push" }), null);
  assert.equal(normalizePushSubscription({ ...VALID_SUBSCRIPTION, keys: { p256dh: "bad key", auth: "short" } }), null);
  assert.equal(normalizePushSubscription(null), null);
});

test("creates a deterministic non-reversible subscription id", () => {
  const first = pushSubscriptionId(VALID_SUBSCRIPTION.endpoint);
  const second = pushSubscriptionId(VALID_SUBSCRIPTION.endpoint);
  assert.equal(first, second);
  assert.equal(first.length, 64);
  assert.notEqual(first, VALID_SUBSCRIPTION.endpoint);
});

test("permits same-origin subscription writes and blocks cross-origin writes", () => {
  const url = "https://thue-ro.vercel.app/api/notifications/subscriptions";
  assert.equal(requestOriginAllowed("https://thue-ro.vercel.app", url, true), true);
  assert.equal(requestOriginAllowed("https://attacker.example", url, true), false);
  assert.equal(requestOriginAllowed(null, url, true), false);
  assert.equal(requestOriginAllowed(null, url, false), true);
});

test("notifies only accepted and recently issued documents", () => {
  const now = Date.parse("2026-07-24T12:00:00.000Z");
  assert.equal(shouldNotifyPublishedDocument(revision(), now, 60), true);
  assert.equal(shouldNotifyPublishedDocument(revision({ accepted: false }), now, 60), false);
  assert.equal(shouldNotifyPublishedDocument(revision({ issuedDate: "2025-01-01" }), now, 60), false);
  assert.equal(shouldNotifyPublishedDocument(revision({ issuedDate: null }), now, 60), false);
});

test("builds an idempotent notification payload that deep-links to the document", () => {
  const payload = publishedDocumentPayload(revision());
  assert.equal(payload.title, "Văn bản thuế mới");
  assert.match(payload.body, /254\/2026\/NĐ-CP/u);
  assert.match(payload.url, /document=254%2F2026%2FN%C4%90-CP/u);
  assert.match(payload.tag, /^legal-/u);
  assert.equal(payload.revisionId, "a".repeat(64));
});

test("recognizes expired push endpoints for automatic cleanup", () => {
  assert.equal(expiredPushSubscriptionError({ statusCode: 404 }), true);
  assert.equal(expiredPushSubscriptionError({ statusCode: 410 }), true);
  assert.equal(expiredPushSubscriptionError({ statusCode: 429 }), false);
  assert.equal(expiredPushSubscriptionError(new Error("network")), false);
});

test("keeps notification history for seven days and sorts newest first", () => {
  const now = Date.parse("2026-07-25T12:00:00.000Z");
  const day = 24 * 60 * 60 * 1_000;
  const retained = pruneNotificationHistory([
    historyItem("six-days", now - 6 * day),
    historyItem("one-day", now - day),
    historyItem("eight-days", now - 8 * day),
    { id: "invalid" },
  ], now);
  assert.equal(NOTIFICATION_HISTORY_RETENTION_DAYS, 7);
  assert.deepEqual(retained.map((item) => item.id), ["one-day", "six-days"]);
});

test("notification UI uses a bell, first-use prompt and history without removed copy", () => {
  const source = readFileSync(new URL("../app/notification-settings.tsx", import.meta.url), "utf8");
  assert.match(source, /<svg viewBox="0 0 24 24"/u);
  assert.match(source, /Bật thông báo\?/u);
  assert.match(source, /Lịch sử thông báo/u);
  assert.match(source, /Tự xóa sau 7 ngày/u);
  assert.doesNotMatch(source, />\s*Thông báo\{state/u);
  assert.doesNotMatch(source, /Nhận thông báo văn bản mới/u);
  assert.doesNotMatch(source, /Chỉ thông báo khi toàn văn từ nguồn chính thức/u);
  assert.doesNotMatch(source, /Thông báo chỉ được bật sau khi bạn đồng ý/u);
  assert.doesNotMatch(source, /Thuế chỉ lưu endpoint kỹ thuật/u);
});

test("service worker receives pushes, stores seven-day history and opens the selected document", () => {
  const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(source, /addEventListener\("push"/u);
  assert.match(source, /showNotification/u);
  assert.match(source, /indexedDB\.open\(HISTORY_DATABASE/u);
  assert.match(source, /HISTORY_RETENTION_MS = 7 \* 24 \* 60 \* 60 \* 1000/u);
  assert.match(source, /THUE_NOTIFICATION_HISTORY_UPDATED/u);
  assert.match(source, /addEventListener\("notificationclick"/u);
  assert.match(source, /THUE_OPEN_DOCUMENT/u);
});

test("service worker pre-caches the current Next app shell and updates static assets", () => {
  const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(source, /const CACHE_NAME = "thue-v11"/u);
  assert.match(source, /cacheCurrentAppShell/u);
  assert.match(source, /\/_next\\\/static\\\//u);
  assert.match(source, /cache\.put\(event\.request, response\.clone\(\)\)/u);
  assert.match(source, /navigationPreload/u);
  assert.match(source, /key\.startsWith\(CACHE_PREFIX\)/u);
});

test("Next headers force service-worker revalidation and basic browser hardening", () => {
  const source = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(source, /source: "\/sw\.js"/u);
  assert.match(source, /no-cache, no-store, must-revalidate/u);
  assert.match(source, /Service-Worker-Allowed/u);
  assert.match(source, /X-Content-Type-Options/u);
  assert.match(source, /Permissions-Policy/u);
});
