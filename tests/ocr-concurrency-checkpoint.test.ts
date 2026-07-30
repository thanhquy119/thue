import assert from "node:assert/strict";
import test from "node:test";
import { ocrTransferredPdfBatch } from "../lib/transfer/pdf-ocr.ts";

function blankPdf(pageCount: number) {
  const pageIds = Array.from({ length: pageCount }, (_, index) => index + 4);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    "<< /Length 0 >>\nstream\n\nendstream",
    ...pageIds.map(() => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 3 0 R >>"),
  ];
  let value = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(value, "ascii"));
    value += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(value, "ascii");
  value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  value += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  value += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(value, "ascii");
}

test("concurrent OCR serializes checkpoint callbacks so no page update is lost", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalInterval = process.env.TRANSFER_OCR_TEST_INTERVAL_MS;
  const originalConcurrency = process.env.TRANSFER_OCR_TEST_CONCURRENCY;
  let callbackActive = 0;
  let callbackMaxActive = 0;
  const savedPages = new Set<number>();

  process.env.GEMINI_API_KEY = "test-key";
  process.env.TRANSFER_OCR_TEST_INTERVAL_MS = "0";
  process.env.TRANSFER_OCR_TEST_CONCURRENCY = "3";
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      contents?: Array<{ parts?: Array<{ text?: string }> }>;
    };
    const instruction = body.contents?.[0]?.parts?.find((part) => part.text)?.text ?? "";
    const page = Number(instruction.match(/OCR trang (\d+)\//u)?.[1] ?? 0);
    await new Promise((resolve) => setTimeout(resolve, page % 2 === 0 ? 2 : 8));
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: `Nội dung OCR trang ${page}` }] } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await ocrTransferredPdfBatch(blankPdf(6), {
      maxPages: 6,
      onPage: async (page) => {
        callbackActive += 1;
        callbackMaxActive = Math.max(callbackMaxActive, callbackActive);
        await new Promise((resolve) => setTimeout(resolve, 3));
        savedPages.add(page.page);
        callbackActive -= 1;
      },
    });
    assert.equal(result.complete, true);
    assert.equal(callbackMaxActive, 1);
    assert.deepEqual([...savedPages].sort((left, right) => left - right), [1, 2, 3, 4, 5, 6]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey == null) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    if (originalInterval == null) delete process.env.TRANSFER_OCR_TEST_INTERVAL_MS;
    else process.env.TRANSFER_OCR_TEST_INTERVAL_MS = originalInterval;
    if (originalConcurrency == null) delete process.env.TRANSFER_OCR_TEST_CONCURRENCY;
    else process.env.TRANSFER_OCR_TEST_CONCURRENCY = originalConcurrency;
  }
});
