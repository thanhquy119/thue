import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {LEGAL_CRON_PAUSED, legalCronPaused} from "../lib/legal/cron-pause.ts";

const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {crons?: unknown[]};
const ingestionRoute = readFileSync(new URL("../app/api/cron/legal-ingestion/route.ts", import.meta.url), "utf8");
const discoveryRoute = readFileSync(new URL("../app/api/cron/fast-tax-discovery/route.ts", import.meta.url), "utf8");

test("không còn Vercel Cron được đăng ký trong deployment", () => {
  assert.equal(Array.isArray(vercel.crons) ? vercel.crons.length : 0, 0);
});

test("chốt Cron đang tạm dừng cho đến khi bật lại thủ công", () => {
  assert.equal(LEGAL_CRON_PAUSED, true);
  assert.equal(legalCronPaused(), true);
});

test("hai route Cron trả về trước phần xử lý nặng khi đang tạm dừng", () => {
  for (const source of [ingestionRoute, discoveryRoute]) {
    const guard = source.indexOf("if (legalCronPaused())");
    assert.ok(guard > 0);
    const discovery = Math.max(source.indexOf("discoverRecentTaxDocuments()"), source.indexOf("discoverBroadTaxDocuments()"));
    assert.ok(discovery > guard);
  }
});
