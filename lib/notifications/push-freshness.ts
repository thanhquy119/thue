import type {
  PublishedDocumentNotification,
  PushNotificationPayload,
} from "./push-core.ts";

export type PublishedNotificationKind = "fresh_document" | "backfilled_full_text";

const FRESH_DOCUMENT_MAX_AGE_DAYS = 3;

function publicationReferenceTime(input: PublishedDocumentNotification) {
  const publishedAt = Date.parse(input.publishedAt);
  return Number.isFinite(publishedAt) ? publishedAt : Date.now();
}

export function publishedNotificationKind(
  input: PublishedDocumentNotification,
  maximumFreshAgeDays = FRESH_DOCUMENT_MAX_AGE_DAYS,
): PublishedNotificationKind {
  if (!input.issuedDate || !/^20\d{2}-\d{2}-\d{2}$/u.test(input.issuedDate)) {
    return "backfilled_full_text";
  }
  const issuedAt = Date.parse(`${input.issuedDate}T00:00:00.000Z`);
  if (!Number.isFinite(issuedAt)) return "backfilled_full_text";
  const age = publicationReferenceTime(input) - issuedAt;
  return age <= Math.max(1, maximumFreshAgeDays) * 86_400_000
    ? "fresh_document"
    : "backfilled_full_text";
}

export function applyPublishedNotificationPresentation(
  payload: PushNotificationPayload,
  input: PublishedDocumentNotification,
): PushNotificationPayload {
  const kind = publishedNotificationKind(input);
  return {
    ...payload,
    title: kind === "fresh_document"
      ? "Văn bản thuế mới"
      : "Đã bổ sung toàn văn",
  };
}
