import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("upload and existing pending files start a server-side OCR chain that survives closing the transfer page", () => {
  const uploadRoute = readFileSync(new URL("../app/api/transfer/upload/route.ts", import.meta.url), "utf8");
  const processRoute = readFileSync(new URL("../app/api/transfer/files/[fileId]/process/route.ts", import.meta.url), "utf8");

  assert.match(uploadRoute, /import \{ after, NextResponse \} from "next\/server"/u);
  assert.match(uploadRoute, /scheduleBackgroundOcr\(requestUrl, parsed\.key, record\)/u);
  assert.match(uploadRoute, /searchParams\.set\("background", "1"\)/u);

  const backgroundStarts = processRoute.match(/after\(async \(\) => runBackgroundOcr/g) ?? [];
  assert.ok(backgroundStarts.length >= 2);
  assert.match(processRoute, /BACKGROUND_BUDGET_MS = 235_000/u);
  assert.match(processRoute, /nextOcrAttemptAt/u);
  assert.match(processRoute, /await handoffBackgroundOcr/u);
  assert.match(processRoute, /await reprocessTransferredPdf\(key, fileId\)/u);
});

test("OCR prompt and deterministic cleanup both exclude printed page numbers", () => {
  const ocr = readFileSync(new URL("../lib/transfer/pdf-ocr.ts", import.meta.url), "utf8");
  assert.match(ocr, /Không chép số trang ở mép trên hoặc mép dưới/u);
  assert.match(ocr, /stripOcrPageMarkers\(normalizeText/u);
});
