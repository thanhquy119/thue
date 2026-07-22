import assert from "node:assert/strict";
import test from "node:test";

const SAMPLE_URL = "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/4/11-bkhcn.pdf";

test("renders an official Government PDF without DataCloneError", { timeout: 90_000 }, async () => {
  const response = await fetch(SAMPLE_URL);
  assert.equal(response.ok, true, `PDF source returned ${response.status}`);
  const source = Buffer.from(await response.arrayBuffer());
  assert.equal(source.subarray(0, 5).toString("ascii"), "%PDF-");

  const [{ PDFParse }, { CanvasFactory }] = await Promise.all([
    import("pdf-parse"),
    import("pdf-parse/worker"),
  ]);
  const parser = new PDFParse({ data: Uint8Array.from(source), CanvasFactory });
  try {
    const text = await parser.getText({ first: 1 });
    const info = await parser.getInfo();
    const screenshot = await parser.getScreenshot({
      first: 1,
      desiredWidth: 900,
      imageDataUrl: false,
      imageBuffer: true,
    });

    assert.ok(info.total >= 1);
    assert.ok(text.text.length > 0);
    assert.ok(screenshot.pages[0]?.data?.byteLength > 1_000);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
});
