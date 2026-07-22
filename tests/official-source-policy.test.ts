import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedLegalSource } from "../lib/legal/ingestion.ts";

test("accepts the official Government PDF for Decree 291/2026/ND-CP", () => {
  assert.equal(
    isAllowedLegalSource("https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/7/291_2026_nd-cp_21072026-signed.signed.pdf"),
    true,
  );
});

test("keeps commercial legal databases outside the official full-text allowlist", () => {
  assert.equal(
    isAllowedLegalSource("https://luatvietnam.vn/thue/nghi-dinh-291-2026-nd-cp.html"),
    false,
  );
});
