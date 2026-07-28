import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("search UI aborts superseded requests and ignores stale responses", () => {
  assert.match(source, /const searchRequestRef = useRef\(0\)/u);
  assert.match(source, /const searchAbortRef = useRef<AbortController \| null>\(null\)/u);
  assert.match(source, /searchAbortRef\.current\?\.abort\(\)/u);
  assert.match(source, /signal: controller\.signal/u);
  assert.match(source, /requestId !== searchRequestRef\.current/u);
  assert.match(source, /55_000/u);
  assert.match(source, /response\.text\(\)/u);
});

test("search UI recovers from invalid or unavailable session cache", () => {
  assert.match(source, /sessionStorage\.removeItem\(cacheKey\)/u);
  assert.match(source, /sessionStorage\.setItem\(cacheKey, JSON\.stringify\(searchPayload\)\)/u);
  assert.match(source, /bộ nhớ phiên đã đầy hoặc bị chặn/u);
});

test("document badge distinguishes every legal effect status", () => {
  assert.match(source, /case "partially_effective":/u);
  assert.match(source, /Còn hiệu lực một phần/u);
  assert.match(source, /case "expired":/u);
  assert.match(source, /Hết hiệu lực/u);
  assert.match(source, /case "repealed":/u);
  assert.match(source, /Đã bị bãi bỏ/u);
  assert.match(source, /statusLabel\(result\.document\.status\)/u);
});
