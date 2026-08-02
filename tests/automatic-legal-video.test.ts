import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

function source(pathname: string) {
  return readFileSync(new URL(`../${pathname}`, import.meta.url), "utf8");
}

test("automatic video rollout only accepts newly issued tax documents after the chosen cutoff", () => {
  const code = source("lib/video/automatic-generation.ts");
  assert.match(code, /DEFAULT_LEGAL_VIDEO_AUTOMATION_START_AT = "2026-08-01T16:21:00\.000Z"/u);
  assert.match(code, /Date\.parse\(revision\.publishedAt\) < Date\.parse\(startAt\)/u);
  assert.match(code, /issuedDate < rolloutDate/u);
  assert.match(code, /classifyStrictTaxDocumentForNotification/u);
  assert.match(code, /reason: "not_tax_document"/u);
  assert.match(code, /const length = "detailed" as const/u);
  assert.match(code, /const voice = "female" as const/u);
});

test("both discovery paths start or reuse the video before dispatching the document push", () => {
  for (const pathname of [
    "app/api/cron/fast-tax-discovery/route.ts",
    "app/api/cron/legal-ingestion/route.ts",
  ]) {
    const code = source(pathname);
    const videoIndex = code.indexOf("startAutomaticLegalVideo(revision)");
    const pushIndex = code.indexOf("await dispatchPublishedDocumentNotifications(notification)");
    assert.ok(videoIndex >= 0, `${pathname} must start automatic video`);
    assert.ok(pushIndex > videoIndex, `${pathname} must publish full text/video state before push`);
  }
});

test("Gemini and Azure limits wait inside Workflow instead of exposing transient quota errors", () => {
  const code = source("workflows/legal-video-generation.ts");
  assert.match(code, /const GEMINI_MAX_ATTEMPTS = 24/u);
  assert.match(code, /const TTS_MAX_ATTEMPTS = 20/u);
  assert.match(code, /VIDEO_GEMINI_MIN_INTERVAL_MS \|\| 5_000/u);
  assert.match(code, /Math\.max\(4_200, configured\)/u);
  assert.match(code, /429\|quota\|rate\.\?limit\|resource\.\?exhausted/u);
  assert.match(code, /Math\.max\(65, explicitSeconds/u);
  assert.match(code, /Đang chờ hạn mức AI rồi tiếp tục/u);
  assert.match(code, /Dịch vụ giọng đọc đang bận; giữ nguyên tiến độ/u);
  assert.match(code, /await sleep\(`/u);
});

test("main deep link preserves full text and turns a stored R2 job into an embedded player", () => {
  const page = source("app/page.tsx");
  const panel = source("app/document-video-panel.tsx");
  const route = source("app/api/videos/document/route.ts");
  const store = source("lib/video/store.ts");

  assert.match(page, /URLSearchParams\(window\.location\.search\)\.get\("document"\)/u);
  assert.match(page, /<DocumentVideoPanel documentNumber=\{result\.document\.number\}/u);
  assert.match(panel, /\/api\/videos\/document\?number=/u);
  assert.match(panel, /Toàn văn đã đọc được ngay/u);
  assert.match(panel, /<video/u);
  assert.match(route, /findLegalVideoJobForDocument/u);
  assert.match(store, /legal-video\/documents\//u);
  assert.match(store, /findLegalVideoJobForDocument/u);
});
