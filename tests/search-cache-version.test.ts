import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("invalidates browser search results when transfer stability fixes ship", () => {
  const source = readFileSync(new URL("../app/cache-version.tsx", import.meta.url), "utf8");
  assert.match(source, /2026-07-29-transfer-stability-v6/u);
  assert.match(source, /key\?\.startsWith\("thue-ro-search-"\)/u);
  assert.match(source, /sessionStorage\.removeItem\(key\)/u);
  assert.match(source, /footer > a\.brand/u);
  assert.doesNotMatch(source, /2026-07-29-transfer-reader-v5/u);
});
