import assert from "node:assert/strict";
import test from "node:test";
import { extractFromFile } from "../lib/legal/ingestion.ts";
import { looksLikeGovernmentPortalShell } from "../lib/legal/document-quality.ts";

const SOURCE = "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/7/94-btc.pdf";

test("live diagnostic extracts Circular 94 with legal structure", { timeout: 180_000 }, async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(SOURCE, {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 Chrome/131 Safari/537.36" },
    });
    assert.equal(response.ok, true, `official PDF returned ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const file = new File([new Uint8Array(buffer)], "94-btc.pdf", { type: "application/pdf" });
    const extracted = await extractFromFile(file);
    const summary = {
      bytes: buffer.length,
      extraction_method: extracted.extractionMethod,
      requires_ocr: extracted.requiresOcr,
      quality_score: extracted.qualityScore,
      characters: extracted.officialText.length,
      portal_shell: looksLikeGovernmentPortalShell(extracted.officialText),
      opening: extracted.officialText.slice(0, 500),
    };
    console.log(`CIRCULAR_94_DIAGNOSTIC ${JSON.stringify(summary)}`);

    assert.equal(extracted.requiresOcr, false);
    assert.equal(summary.portal_shell, false);
    assert.ok(extracted.officialText.length >= 5_000);
    assert.match(extracted.officialText.slice(0, 20_000), /94\s*\/\s*2026\s*\/\s*TT-BTC/iu);
    assert.match(extracted.officialText, /^|\n\s*Điều\s+1\b/imu);
  } finally {
    clearTimeout(timer);
  }
});
