import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeTransferKey,
  safeTransferFilename,
  transferMailboxId,
  transferSourcePath,
  validTransferKey,
} from "../lib/transfer/core.ts";

test("normalizes and validates a persistent transfer key", () => {
  const raw = "AB12-CD34-EF56-GH78-IJ90-KL12";
  assert.equal(normalizeTransferKey(raw), "AB12CD34EF56GH78IJ90KL12");
  assert.equal(validTransferKey(raw), true);
  assert.equal(validTransferKey("too-short"), false);
});

test("mailbox id is deterministic without exposing the pairing key", () => {
  const key = "AB12CD34EF56GH78IJ90KL12";
  const first = transferMailboxId(key);
  const second = transferMailboxId(key);
  assert.equal(first, second);
  assert.equal(first.length, 64);
  assert.doesNotMatch(first, /AB12/u);
});

test("upload pathname is scoped to one mailbox and sanitized", () => {
  const mailbox = transferMailboxId("AB12CD34EF56GH78IJ90KL12");
  const name = safeTransferFilename("../Báo cáo\\thuế.pdf");
  const pathname = transferSourcePath(mailbox, "12345678-abcd-4321-abcd-123456789012", name);
  assert.match(pathname, /^transfers\/[a-f0-9]{64}\//u);
  assert.doesNotMatch(pathname, /\.\.\//u);
  assert.match(pathname, /Báo cáo-thuế\.pdf$/u);
});

test("transfer page remembers pairing, uploads directly and supports speech", () => {
  const source = readFileSync(new URL("../app/transfer/page.tsx", import.meta.url), "utf8");
  assert.match(source, /localStorage\.setItem\(STORAGE_KEY/u);
  assert.match(source, /localStorage\.getItem\(STORAGE_KEY/u);
  assert.match(source, /upload\(pathname, file/u);
  assert.match(source, /access: "private"/u);
  assert.match(source, /window\.setInterval\(.*5_000/su);
  assert.match(source, /SpeechSynthesisUtterance/u);
  assert.match(source, /PDF, Word, TXT/u);
});

test("QR pairing stays client-side and automatically clears the secret fragment", () => {
  const source = readFileSync(new URL("../app/transfer/page.tsx", import.meta.url), "utf8");
  assert.match(source, /QRCodeSVG/u);
  assert.match(source, /\/transfer#pair=/u);
  assert.match(source, /window\.location\.hash/u);
  assert.match(source, /history\.replaceState/u);
  assert.doesNotMatch(source, /\/transfer\?pair=/u);
  assert.match(source, /Kết nối thiết bị khác/u);
});

test("transferred documents reuse the main application reader structure", () => {
  const source = readFileSync(new URL("../app/transfer/page.tsx", import.meta.url), "utf8");
  assert.match(source, /className="documentDetail transferDocumentDetail"/u);
  assert.match(source, /className="detailHeader"/u);
  assert.match(source, /className="readerBlock"/u);
  assert.match(source, /className="readerText"/u);
  assert.match(source, /className="legalProvision"/u);
  assert.match(source, /className={`legalBlock \$\{block\.kind\}/u);
  assert.match(source, /className={`audioDock/u);
  assert.doesNotMatch(source, /Mã kết nối được lưu trên từng trình duyệt/u);
});

test("home footer is converted into the device transfer action", () => {
  const source = readFileSync(new URL("../app/cache-version.tsx", import.meta.url), "utf8");
  assert.match(source, /footer > a\.brand/u);
  assert.match(source, /footerBrand\.href = "\/transfer"/u);
  assert.match(source, /Chuyển file giữa thiết bị/u);
});

test("scanned PDF processing is explicitly bounded", () => {
  const source = readFileSync(new URL("../lib/transfer/pdf-ocr.ts", import.meta.url), "utf8");
  assert.match(source, /const MAX_PAGES = 6/u);
  assert.match(source, /\[không đọc rõ\]/u);
  assert.match(source, /Math\.min\(totalPages, MAX_PAGES\)/u);
});
