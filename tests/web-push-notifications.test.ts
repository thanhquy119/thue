import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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
  assert.equal(payload.title, "Văn bản mới đã sẵn sàng");
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

test("service worker receives pushes and opens the selected document", () => {
  const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(source, /addEventListener\("push"/u);
  assert.match(source, /showNotification/u);
  assert.match(source, /addEventListener\("notificationclick"/u);
  assert.match(source, /THUE_OPEN_DOCUMENT/u);
});
