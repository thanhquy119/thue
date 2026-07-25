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

const WITHOUT_R2 = {
  R2_ENDPOINT: undefined,
  R2_BUCKET: undefined,
  R2_ACCESS_KEY_ID: undefined,
  R2_SECRET_ACCESS_KEY: undefined,
  LEGAL_R2_SOFT_LIMIT_BYTES: undefined,
} as const;

test("uses conservative free-tier Blob defaults", () => {
  withEnvironment(
    {
      ...WITHOUT_R2,
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
      ...WITHOUT_R2,
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

test("rejects invalid Blob policy values and returns safe defaults", () => {
  withEnvironment(
    {
      ...WITHOUT_R2,
      LEGAL_BLOB_SOFT_LIMIT_BYTES: "not-a-number",
      LEGAL_RUN_RETENTION_DAYS: "0",
    },
    () => {
      assert.equal(durableStoreSoftLimitBytes(), 750_000_000);
      assert.equal(durableRunRetentionDays(), 30);
    },
  );
});

test("uses a five-gigabyte R2 soft limit when R2 is configured", () => {
  withEnvironment(
    {
      R2_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      R2_BUCKET: "private-bucket",
      R2_ACCESS_KEY_ID: "access-key",
      R2_SECRET_ACCESS_KEY: "secret-key",
      LEGAL_R2_SOFT_LIMIT_BYTES: undefined,
    },
    () => assert.equal(durableStoreSoftLimitBytes(), 5_000_000_000),
  );
});
