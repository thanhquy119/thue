import assert from "node:assert/strict";
import test from "node:test";
import {
  claimFastTaxDiscoveryStarts,
  mergeFastTaxDiscoveryIndex,
  recentFastTaxDiscoveryNumbers,
} from "../lib/legal/fast-tax-discovery-core.ts";
import type { DurableLegalSource } from "../lib/legal/durable-ingestion-types.ts";
import { parseLatestGovernmentTaxDocuments } from "../lib/legal/latest-government-tax-feed.ts";
import {
  applyPublishedNotificationPresentation,
  publishedNotificationKind,
} from "../lib/notifications/push-freshness.ts";
import type {
  PublishedDocumentNotification,
  PushNotificationPayload,
} from "../lib/notifications/push-core.ts";

function source(number: string, issuedDate = "2026-07-28"): DurableLegalSource {
  return {
    number,
    title: `Văn bản thuế ${number}`,
    type: number.includes("TT-") ? "Thông tư" : "Nghị định",
    issuer: number.includes("TT-") ? "Bộ Tài chính" : "Chính phủ",
    issuedDate,
    effectiveDate: null,
    officialPageUrl: `https://vanban.chinhphu.vn/${encodeURIComponent(number)}`,
    sourceUrl: `https://datafiles.chinhphu.vn/${encodeURIComponent(number)}.pdf`,
    sourceLabel: "Nguồn chính thức",
  };
}

function notification(
  patch: Partial<PublishedDocumentNotification> = {},
): PublishedDocumentNotification {
  return {
    revisionId: "a".repeat(64),
    number: "300/2026/NĐ-CP",
    title: "Quy định về quản lý thuế",
    issuedDate: "2026-07-27",
    publishedAt: "2026-07-28T03:00:00.000Z",
    accepted: true,
    documentType: "Nghị định",
    issuer: "Chính phủ",
    officialText: "Điều 1. Quy định quản lý thuế và nghĩa vụ thuế.",
    ...patch,
  };
}

const payload: PushNotificationPayload = {
  title: "Văn bản thuế mới",
  body: "300/2026/NĐ-CP",
  tag: "legal-test",
  url: "/?document=300",
  number: "300/2026/NĐ-CP",
  revisionId: "a".repeat(64),
  icon: "/icon-192.png",
  badge: "/icon-192.png",
};

test("first fast discovery run bootstraps without treating the backlog as new", () => {
  const merged = mergeFastTaxDiscoveryIndex(
    null,
    [source("300/2026/NĐ-CP"), source("99/2026/TT-BTC")],
    "2026-07-28T03:00:00.000Z",
  );
  assert.equal(merged.bootstrapped, true);
  assert.deepEqual(merged.newNumbers, []);
  assert.equal(Object.keys(merged.index.candidates).length, 2);
});

test("later scans return only document numbers not seen in the bootstrap", () => {
  const initial = mergeFastTaxDiscoveryIndex(
    null,
    [source("300/2026/NĐ-CP")],
    "2026-07-28T03:00:00.000Z",
  );
  const next = mergeFastTaxDiscoveryIndex(
    initial.index,
    [source("300/2026/NĐ-CP"), source("301/2026/NĐ-CP")],
    "2026-07-28T03:15:00.000Z",
  );
  const existing = Object.values(next.index.candidates).find(
    (candidate) => candidate.number === "300/2026/NĐ-CP",
  );
  assert.equal(next.bootstrapped, false);
  assert.deepEqual(next.newNumbers, ["301/2026/NĐ-CP"]);
  assert.equal(existing?.firstSeenAt, "2026-07-28T03:00:00.000Z");
});

test("daily fast-start claims are idempotent and respect the quota", () => {
  const initial = mergeFastTaxDiscoveryIndex(
    null,
    [source("300/2026/NĐ-CP")],
    "2026-07-28T03:00:00.000Z",
  ).index;
  const first = claimFastTaxDiscoveryStarts(
    initial,
    ["301/2026/NĐ-CP", "302/2026/NĐ-CP", "303/2026/NĐ-CP"],
    "2026-07-28T03:15:00.000Z",
    2,
  );
  assert.deepEqual(first.claimed, ["301/2026/NĐ-CP", "302/2026/NĐ-CP"]);
  const second = claimFastTaxDiscoveryStarts(
    first.index,
    ["301/2026/NĐ-CP", "303/2026/NĐ-CP"],
    "2026-07-28T03:30:00.000Z",
    2,
  );
  assert.deepEqual(second.claimed, []);
});

test("notification scan orders the most recently seen candidates first", () => {
  const first = mergeFastTaxDiscoveryIndex(
    null,
    [source("300/2026/NĐ-CP")],
    "2026-07-28T03:00:00.000Z",
  );
  const second = mergeFastTaxDiscoveryIndex(
    first.index,
    [source("301/2026/NĐ-CP")],
    "2026-07-28T03:15:00.000Z",
  );
  assert.deepEqual(
    recentFastTaxDiscoveryNumbers(second.index, 2),
    ["301/2026/NĐ-CP", "300/2026/NĐ-CP"],
  );
});

test("direct Government listing keeps tax documents and ignores unrelated documents", () => {
  const html = `
    <div>
      <span>299/2026/NĐ-CP</span>
      <span>Ngày ban hành: 28/07/2026</span>
      <a href="/?classid=1&docid=299999">Quy định mới về quản lý thuế và hóa đơn điện tử</a>
    </div>
    ${"x".repeat(2_000)}
    <div>
      <span>298/2026/NĐ-CP</span>
      <span>Ngày ban hành: 27/07/2026</span>
      <a href="/?classid=1&docid=298888">Quy định cơ cấu tổ chức ngành văn hóa</a>
    </div>
  `;
  const documents = parseLatestGovernmentTaxDocuments(html);
  assert.deepEqual(documents.map((document) => document.number), ["299/2026/NĐ-CP"]);
  assert.equal(documents[0]?.issuedDate, "2026-07-28");
  assert.equal(documents[0]?.issuer, "Chính phủ");
});

test("a document published soon after issuance keeps the new-document title", () => {
  const input = notification();
  assert.equal(publishedNotificationKind(input), "fresh_document");
  assert.equal(
    applyPublishedNotificationPresentation(payload, input).title,
    "Văn bản thuế mới",
  );
});

test("a late full-text backfill is not presented as a newly issued document", () => {
  const input = notification({
    issuedDate: "2026-06-30",
    publishedAt: "2026-07-27T01:52:04.562Z",
  });
  assert.equal(publishedNotificationKind(input), "backfilled_full_text");
  assert.equal(
    applyPublishedNotificationPresentation(payload, input).title,
    "Đã bổ sung toàn văn",
  );
});
