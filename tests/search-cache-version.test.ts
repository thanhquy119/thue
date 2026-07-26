import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("invalidates browser search results created before deep legal evidence retrieval", () => {
  const source = readFileSync(new URL("../app/cache-version.tsx", import.meta.url), "utf8");
  assert.match(source, /2026-07-26-deep-legal-evidence-v1/u);
  assert.match(source, /key\?\.startsWith\("thue-ro-search-"\)/u);
  assert.match(source, /sessionStorage\.removeItem\(key\)/u);
  assert.doesNotMatch(source, /2026-07-25-notification-history-v1/u);
});
