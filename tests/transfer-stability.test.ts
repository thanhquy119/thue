import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("legacy Office refresh no longer blocks the first document response", () => {
  const store = readFileSync(new URL("../lib/transfer/store.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/transfer/files/[fileId]/route.ts", import.meta.url), "utf8");
  const readFunction = store.slice(
    store.indexOf("export async function readTransferredFile"),
    store.indexOf("export async function refreshTransferredFileExtraction"),
  );
  assert.doesNotMatch(readFunction, /refreshLegacyOfficeExtraction/u);
  assert.match(route, /after\(async \(\) =>/u);
  assert.match(route, /refreshTransferredFileExtraction/u);
  assert.match(route, /maxDuration = 300/u);
});

test("source-file enhancement is on-demand and mutation updates are idempotent", () => {
  const enhancer = readFileSync(new URL("../app/transfer/qr-scanner-enhancer.tsx", import.meta.url), "utf8");
  assert.match(enhancer, /async function openOriginalFile/u);
  assert.match(enhancer, /button\.dataset\.busy === "true"/u);
  assert.match(enhancer, /button\.textContent !== "Mở hoặc lưu file gốc"/u);
  assert.match(enhancer, /Opening and listening to the converted text must never depend/u);
  assert.doesNotMatch(enhancer, /prepareSource/u);
  assert.doesNotMatch(enhancer, /preparedSourceRef/u);
});

test("original plus and delete glyphs override the shifted pseudo-elements", () => {
  const layout = readFileSync(new URL("../app/transfer/layout.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../app/transfer/icon-reset.css", import.meta.url), "utf8");
  assert.match(layout, /qr-scanner\.css[\s\S]*icon-reset\.css/u);
  assert.match(styles, /content: none !important/u);
  assert.match(styles, /\.uploadPlus[\s\S]*font-size: 32px !important/u);
  assert.match(styles, /\.transferDelete[\s\S]*font-size: 22px !important/u);
});
