export const NOTIFICATION_HISTORY_RETENTION_DAYS = 7;
export const NOTIFICATION_HISTORY_RETENTION_MS = NOTIFICATION_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1_000;

export type NotificationHistoryItem = {
  id: string;
  title: string;
  body: string;
  url: string;
  number: string | null;
  revisionId: string | null;
  receivedAt: number;
};

export function isNotificationHistoryItem(value: unknown): value is NotificationHistoryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<NotificationHistoryItem>;
  return Boolean(
    typeof item.id === "string" && item.id.trim() &&
    typeof item.title === "string" &&
    typeof item.body === "string" &&
    typeof item.url === "string" && item.url.startsWith("/") &&
    (item.number === null || typeof item.number === "string") &&
    (item.revisionId === null || typeof item.revisionId === "string") &&
    typeof item.receivedAt === "number" && Number.isFinite(item.receivedAt),
  );
}

export function pruneNotificationHistory(values: unknown[], nowMs = Date.now()) {
  const cutoff = nowMs - NOTIFICATION_HISTORY_RETENTION_MS;
  const maximumFutureTime = nowMs + 24 * 60 * 60 * 1_000;
  return values
    .filter(isNotificationHistoryItem)
    .filter((item) => item.receivedAt >= cutoff && item.receivedAt <= maximumFutureTime)
    .sort((left, right) => right.receivedAt - left.receivedAt);
}
