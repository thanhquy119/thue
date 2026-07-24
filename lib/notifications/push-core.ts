import { createHash } from "node:crypto";

export type BrowserPushSubscription = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export type StoredPushSubscription = {
  id: string;
  subscription: BrowserPushSubscription;
  topics: ["new_documents"];
  createdAt: string;
  updatedAt: string;
};

export type PublishedDocumentNotification = {
  revisionId: string;
  number: string;
  title: string;
  issuedDate: string | null;
  publishedAt: string;
  accepted: boolean;
};

export type PushNotificationPayload = {
  title: string;
  body: string;
  tag: string;
  url: string;
  number: string;
  revisionId: string;
  icon: string;
  badge: string;
};

const BASE64_URL = /^[A-Za-z0-9_-]+$/u;
const PUSH_ENDPOINT_HOSTS = [
  "fcm.googleapis.com",
  ".push.services.mozilla.com",
  "web.push.apple.com",
  ".notify.windows.com",
] as const;

function allowedPushEndpointHost(hostname: string) {
  const host = hostname.toLocaleLowerCase("en");
  return PUSH_ENDPOINT_HOSTS.some((allowed) =>
    allowed.startsWith(".") ? host.endsWith(allowed) : host === allowed,
  );
}

function cleanKey(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (clean.length < minimum || clean.length > maximum || !BASE64_URL.test(clean)) return null;
  return clean;
}

export function normalizePushSubscription(value: unknown): BrowserPushSubscription | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    endpoint?: unknown;
    expirationTime?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown } | null;
  };
  if (typeof candidate.endpoint !== "string" || candidate.endpoint.length > 2_048) return null;

  let endpoint: URL;
  try {
    endpoint = new URL(candidate.endpoint.trim());
  } catch {
    return null;
  }
  if (endpoint.protocol !== "https:" || !allowedPushEndpointHost(endpoint.hostname)) return null;

  const p256dh = cleanKey(candidate.keys?.p256dh, 40, 256);
  const auth = cleanKey(candidate.keys?.auth, 12, 128);
  if (!p256dh || !auth) return null;

  const expirationTime = candidate.expirationTime == null
    ? null
    : typeof candidate.expirationTime === "number" && Number.isFinite(candidate.expirationTime)
      ? candidate.expirationTime
      : null;

  return {
    endpoint: endpoint.toString(),
    expirationTime,
    keys: { p256dh, auth },
  };
}

export function pushSubscriptionId(endpoint: string) {
  return createHash("sha256").update(endpoint).digest("hex");
}

export function requestOriginAllowed(requestOrigin: string | null, requestUrl: string, production: boolean) {
  if (!requestOrigin) return !production;
  try {
    return new URL(requestOrigin).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

export function shouldNotifyPublishedDocument(
  input: PublishedDocumentNotification,
  nowMs = Date.now(),
  maximumAgeDays = 60,
) {
  if (!input.accepted || !input.revisionId || !input.number || !input.title || !input.issuedDate) return false;
  if (!/^20\d{2}-\d{2}-\d{2}$/u.test(input.issuedDate)) return false;
  const issuedAt = Date.parse(`${input.issuedDate}T00:00:00.000Z`);
  if (!Number.isFinite(issuedAt)) return false;
  const age = nowMs - issuedAt;
  return age >= -86_400_000 && age <= Math.max(1, maximumAgeDays) * 86_400_000;
}

function compact(value: string, maximum: number) {
  const clean = value.replace(/\s+/gu, " ").trim();
  if (clean.length <= maximum) return clean;
  return `${clean.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

export function publishedDocumentPayload(input: PublishedDocumentNotification): PushNotificationPayload {
  return {
    title: "Văn bản mới đã sẵn sàng",
    body: compact(`${input.number} — ${input.title}`, 180),
    tag: `legal-${input.revisionId.slice(0, 24)}`,
    url: `/?document=${encodeURIComponent(input.number)}&source=notification`,
    number: input.number,
    revisionId: input.revisionId,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
  };
}

export function pushErrorStatus(error: unknown) {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function expiredPushSubscriptionError(error: unknown) {
  const status = pushErrorStatus(error);
  return status === 404 || status === 410;
}
