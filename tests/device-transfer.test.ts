import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  TRANSFER_MAX_UPLOAD_CHUNKS,
  TRANSFER_UPLOAD_CHUNK_BYTES,
  normalizeTransferKey,
  safeTransferFilename,
  transferMailboxId,
  transferSourcePath,
  transferUploadChunkPath,
  validTransferKey,
} from "../lib/transfer/core.ts";
import {
  normalizeTransferredText,
  TRANSFER_EXTRACTION_VERSION,
} from "../lib/transfer/extraction.ts";
import { pairingKeyFromQr } from "../lib/transfer/qr-pairing.ts";

test("normalizes transfer keys and scopes private upload paths", () => {
  const raw = "AB12-CD34-EF56-GH78-IJ90-KL12";
  assert.equal(normalizeTransferKey(raw), "AB12CD34EF56GH78IJ90KL12");
  assert.equal(validTransferKey(raw), true);
  assert.equal(validTransferKey("too-short"), false);
  const mailbox = transferMailboxId(raw);
  assert.equal(mailbox.length, 64);
  assert.doesNotMatch(mailbox, /AB12/u);
  const filename = safeTransferFilename("../Báo cáo\\thuế.pdf");
  assert.match(transferSourcePath(mailbox, "12345678-abcd-4321-abcd-123456789012", filename), /Báo cáo-thuế\.pdf$/u);
});

test("chunk uploads stay bounded and ordered", () => {
  const mailbox = transferMailboxId("AB12CD34EF56GH78IJ90KL12");
  const fileId = "12345678-abcd-4321-abcd-123456789012";
  assert.equal(TRANSFER_UPLOAD_CHUNK_BYTES, 2_500_000);
  assert.equal(TRANSFER_MAX_UPLOAD_CHUNKS, 20);
  assert.match(transferUploadChunkPath(mailbox, fileId, 0), /\/000\.bin$/u);
  assert.match(transferUploadChunkPath(mailbox, fileId, 19), /\/019\.bin$/u);
  assert.throws(() => transferUploadChunkPath(mailbox, fileId, 20), /không hợp lệ/u);
});

test("transfer page supports pairing, chunk upload, speech, articles and spreadsheets", () => {
  const source = readFileSync(new URL("../app/transfer/page.tsx", import.meta.url), "utf8");
  assert.match(source, /localStorage\.setItem\(STORAGE_KEY/u);
  assert.match(source, /action: "init"/u);
  assert.match(source, /method: "PUT"/u);
  assert.match(source, /action: "complete"/u);
  assert.match(source, /SpeechSynthesisUtterance/u);
  assert.match(source, /PDF, Word, Excel, CSV, ODS, TXT/u);
  assert.match(source, /splitTransferredReaderItems/u);
  assert.match(source, /Điều trước/u);
  assert.match(source, /Điều sau/u);
  assert.match(source, /\.xlsx/u);
  assert.doesNotMatch(source, /@vercel\/blob\/client/u);
});

test("structured extraction keeps table boundaries at the current version", () => {
  const value = normalizeTransferredText([
    "STT\tTrường thông tin\tKiểu dữ liệu\tĐộ dài",
    "1\tMã hồ sơ\tString\t13",
  ].join("\n"));
  assert.equal(TRANSFER_EXTRACTION_VERSION, 4);
  assert.match(value, /\uE002STT\uE000Trường thông tin/u);
  assert.match(value, /1\uE000Mã hồ sơ\uE000String\uE00013\uE001\uE003/u);
});

test("transfer APIs use R2 and stream original files privately", () => {
  const upload = readFileSync(new URL("../app/api/transfer/upload/route.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("../lib/transfer/store.ts", import.meta.url), "utf8");
  const sourceRoute = readFileSync(new URL("../app/api/transfer/files/[fileId]/source/route.ts", import.meta.url), "utf8");
  assert.match(upload, /r2-blob-compat/u);
  assert.match(store, /r2-blob-compat/u);
  assert.doesNotMatch(store, /from "@vercel\/blob"/u);
  assert.match(sourceRoute, /x-transfer-key/u);
  assert.match(sourceRoute, /private, no-store/u);
  assert.match(sourceRoute, /filename\*=UTF-8/u);
});

test("device-aware pairing and installed PWA QR scanning remain same-origin", () => {
  const scanner = readFileSync(new URL("../app/transfer/qr-camera-scanner.tsx", import.meta.url), "utf8");
  const enhancer = readFileSync(new URL("../app/transfer/qr-scanner-enhancer.tsx", import.meta.url), "utf8");
  const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(scanner, /navigator\.mediaDevices\.getUserMedia/u);
  assert.match(scanner, /capture="environment"/u);
  assert.match(enhancer, /detectDeviceKind/u);
  assert.match(enhancer, /window\.location\.replace\("\/transfer"\)/u);
  assert.match(config, /camera=\(self\)/u);
  const key = "AB12CD34EF56GH78IJ90KL12";
  const origin = "https://thue-ro.vercel.app";
  assert.equal(pairingKeyFromQr(`${origin}/transfer#pair=${key}`, origin), key);
  assert.equal(pairingKeyFromQr(`https://example.com/transfer#pair=${key}`, origin), null);
});

test("reader keeps justified text, structured tables and native file sharing", () => {
  const enhancer = readFileSync(new URL("../app/transfer/qr-scanner-enhancer.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../app/transfer/qr-scanner.css", import.meta.url), "utf8");
  assert.match(enhancer, /enhanceStructuredTables/u);
  assert.match(enhancer, /Mở hoặc lưu file gốc/u);
  assert.match(enhancer, /navigator\.share/u);
  assert.match(styles, /text-align: justify/u);
  assert.match(styles, /transferStructuredCell/u);
});

test("PDF OCR is deliberately slow, globally serialized and checkpointed", () => {
  const ocr = readFileSync(new URL("../lib/transfer/pdf-ocr.ts", import.meta.url), "utf8");
  const core = readFileSync(new URL("../lib/transfer/core.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("../lib/transfer/store.ts", import.meta.url), "utf8");
  assert.match(ocr, /OCR_REQUEST_INTERVAL_MS = 30_000/u);
  assert.match(ocr, /OCR_PAGES_PER_RUN = 5/u);
  assert.match(ocr, /DEFAULT_QUOTA_RETRY_MS = 180_000/u);
  assert.match(ocr, /\[không đọc rõ\]/u);
  assert.match(core, /transferGlobalOcrLeasePath/u);
  assert.match(store, /transferOcrCheckpointPath/u);
});
