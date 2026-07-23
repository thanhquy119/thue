import assert from "node:assert/strict";
import test from "node:test";
import {
  durableRunRetentionDays,
  durableStoreAccess,
  durableStoreSoftLimitBytes,
} from "../lib/legal/durable-document-store.ts";

function withEnvironment(values: Record<string, string | undefined>, run: () => void) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("uses conservative free-tier Blob defaults", () => {
  withEnvironment(
    {
      LEGAL_BLOB_ACCESS: undefined,
      LEGAL_BLOB_SOFT_LIMIT_BYTES: undefined,
      LEGAL_RUN_RETENTION_DAYS: undefined,
    },
    () => {
      assert.equal(durableStoreAccess(), "public");
      assert.equal(durableStoreSoftLimitBytes(), 750_000_000);
      assert.equal(durableRunRetentionDays(), 30);
    },
  );
});

test("accepts private Blob and explicit retention limits", () => {
  withEnvironment(
    {
      LEGAL_BLOB_ACCESS: "private",
      LEGAL_BLOB_SOFT_LIMIT_BYTES: "700000000",
      LEGAL_RUN_RETENTION_DAYS: "14",
    },
    () => {
      assert.equal(durableStoreAccess(), "private");
      assert.equal(durableStoreSoftLimitBytes(), 700_000_000);
      assert.equal(durableRunRetentionDays(), 14);
    },
  );
});

test("rejects invalid policy values and returns safe defaults", () => {
  withEnvironment(
    {
      LEGAL_BLOB_SOFT_LIMIT_BYTES: "not-a-number",
      LEGAL_RUN_RETENTION_DAYS: "0",
    },
    () => {
      assert.equal(durableStoreSoftLimitBytes(), 750_000_000);
      assert.equal(durableRunRetentionDays(), 30);
    },
  );
});
