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

test("chunk paths are bounded, ordered and stay inside one mailbox", () => {
  const mailbox = transferMailboxId("AB12CD34EF56GH78IJ90KL12");
  const fileId = "12345678-abcd-4321-abcd-123456789012";
  assert.equal(TRANSFER_UPLOAD_CHUNK_BYTES, 2_500_000);
  assert.equal(TRANSFER_MAX_UPLOAD_CHUNKS, 20);
  assert.match(transferUploadChunkPath(mailbox, fileId, 0), /\/upload\/chunks\/000\.bin$/u);
  assert.match(transferUploadChunkPath(mailbox, fileId, 19), /\/upload\/chunks\/019\.bin$/u);
  assert.throws(() => transferUploadChunkPath(mailbox, fileId, 20), /không hợp lệ/u);
});

test("transfer page remembers pairing, uploads bounded chunks and supports speech", () => {
  const source = readFileSync(new URL("../app/transfer/page.tsx", import.meta.url), "utf8");
  assert.match(source, /localStorage\.setItem\(STORAGE_KEY/u);
  assert.match(source, /localStorage\.getItem\(STORAGE_KEY/u);
  assert.match(source, /const UPLOAD_CHUNK_BYTES = 2_500_000/u);
  assert.match(source, /action: "init"/u);
  assert.match(source, /method: "PUT"/u);
  assert.match(source, /action: "complete"/u);
  assert.doesNotMatch(source, /@vercel\/blob\/client/u);
  assert.match(source, /window\.setInterval\(.*5_000/su);
  assert.match(source, /SpeechSynthesisUtterance/u);
  assert.match(source, /PDF, Word, TXT/u);
});

test("transfer upload initializes directly in R2 instead of probing suspended Blob", () => {
  const route = readFileSync(new URL("../app/api/transfer/upload/route.ts", import.meta.url), "utf8");
  const initialize = route.slice(route.indexOf("async function initializeUpload"), route.indexOf("async function completeUpload"));
  assert.doesNotMatch(initialize, /readSession/u);
  assert.match(initialize, /allowOverwrite: true/u);
  assert.match(route, /Vercel Blob.*403/u);
  assert.match(route, /console\.error\("\[transfer-upload\]"/u);
});

test("transfer APIs and store use the R2-compatible storage layer", () => {
  const route = readFileSync(new URL("../app/api/transfer/upload/route.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("../lib/transfer/store.ts", import.meta.url), "utf8");
  const health = readFileSync(new URL("../app/api/transfer/health/route.ts", import.meta.url), "utf8");
  assert.match(route, /r2-blob-compat/u);
  assert.match(route, /expectedBytes/u);
  assert.match(route, /Buffer\.concat/u);
  assert.match(store, /r2-blob-compat/u);
  assert.match(health, /storageBackend/u);
  assert.doesNotMatch(store, /from "@vercel\/blob"/u);
  assert.doesNotMatch(health, /from "@vercel\/blob"/u);
});

test("Word and HTML extraction retain invisible table boundaries", () => {
  const value = normalizeTransferredText([
    "I. THÔNG TIN ĐẦU VÀO",
    "STT\tTrường thông tin\tKiểu dữ liệu\tĐộ dài",
    "1\tMã hồ sơ\tString\t13",
    "Đoạn văn tiếp theo",
  ].join("\n"));
  assert.equal(TRANSFER_EXTRACTION_VERSION, 2);
  assert.match(value, /\uE002STT\uE000Trường thông tin/u);
  assert.match(value, /Độ dài\uE001/u);
  assert.match(value, /1\uE000Mã hồ sơ\uE000String\uE00013\uE001\uE003/u);
  assert.match(value, /Đoạn văn tiếp theo/u);
});

test("legacy Office files are refreshed once with the current structured extraction", () => {
  const core = readFileSync(new URL("../lib/transfer/core.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("../lib/transfer/store.ts", import.meta.url), "utf8");
  assert.match(core, /extractionVersion\?: number/u);
  assert.match(store, /refreshLegacyOfficeExtraction/u);
  assert.match(store, /TRANSFER_EXTRACTION_VERSION/u);
  assert.match(store, /\["doc", "docx", "html"\]/u);
  assert.match(store, /await writeJson\(textPathname/u);
});

test("original transferred files are streamed privately for Preview and Files", () => {
  const route = readFileSync(new URL("../app/api/transfer/files/[fileId]/source/route.ts", import.meta.url), "utf8");
  assert.match(route, /x-transfer-key/u);
  assert.match(route, /readTransferredFile/u);
  assert.match(route, /meta\.sourcePathname/u);
  assert.match(route, /content-disposition/u);
  assert.match(route, /filename\*=UTF-8/u);
  assert.match(route, /private, no-store/u);
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

test("device-aware pairing shows desktop QR, opens mobile scanner and hides legacy controls", () => {
  const enhancer = readFileSync(new URL("../app/transfer/qr-scanner-enhancer.tsx", import.meta.url), "utf8");
  const session = readFileSync(new URL("../app/api/transfer/session/route.ts", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../app/transfer/qr-scanner.css", import.meta.url), "utf8");
  assert.match(enhancer, /detectDeviceKind/u);
  assert.match(enhancer, /\.pairPanel > div:first-child button/u);
  assert.match(enhancer, /scannerRef\.current\?\.open\(\)/u);
  assert.match(enhancer, /role: kind === "desktop" \? "host" : "join"/u);
  assert.match(enhancer, /heading\.textContent = "Gửi file sang điện thoại\."/u);
  assert.match(enhancer, /kind === "mobile" && !key/u);
  assert.match(enhancer, /transferPeerConnected/u);
  assert.match(session, /device_id/u);
  assert.match(session, /deviceMarkerPrefix/u);
  assert.match(session, /deviceCount >= 2/u);
  assert.match(session, /await list\(/u);
  assert.match(session, /await put\(/u);
  assert.match(styles, /\.transferShell \.connectionBar/u);
  assert.match(styles, /\.transferDeviceDesktop \.pairPanel/u);
  assert.match(styles, /\.transferPeerConnected \.pairQrPanel/u);
});

test("installed PWA scans and connects without navigating through Safari", () => {
  const scanner = readFileSync(new URL("../app/transfer/qr-camera-scanner.tsx", import.meta.url), "utf8");
  const enhancer = readFileSync(new URL("../app/transfer/qr-scanner-enhancer.tsx", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../app/transfer/layout.tsx", import.meta.url), "utf8");
  const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(scanner, /navigator\.mediaDevices\.getUserMedia/u);
  assert.match(scanner, /facingMode: \{ ideal: "environment" \}/u);
  assert.match(scanner, /playsInline/u);
  assert.match(scanner, /jsqr@1\.4\.0/u);
  assert.match(scanner, /capture="environment"/u);
  assert.match(scanner, /Khung hình và ảnh QR chỉ được xử lý ngay trên thiết bị/u);
  assert.match(enhancer, /Quét QR trong ứng dụng/u);
  assert.match(enhancer, /window\.localStorage\.setItem\(STORAGE_KEY, key\)/u);
  assert.match(enhancer, /window\.location\.replace\("\/transfer"\)/u);
  assert.match(layout, /QrScannerEnhancer/u);
  assert.match(config, /camera=\(self\)/u);
  assert.doesNotMatch(config, /camera=\(\)/u);
});

test("transfer reader justifies text, fixes centered icons and upgrades table markers", () => {
  const enhancer = readFileSync(new URL("../app/transfer/qr-scanner-enhancer.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../app/transfer/qr-scanner.css", import.meta.url), "utf8");
  assert.match(enhancer, /enhanceStructuredTables/u);
  assert.match(enhancer, /role", "table"/u);
  assert.match(enhancer, /transferStructuredCell/u);
  assert.match(styles, /text-align: justify/u);
  assert.match(styles, /\.transferDocumentDetail \.legalBlocks/u);
  assert.match(styles, /margin-left: 0/u);
  assert.match(styles, /\.uploadPlus::before/u);
  assert.match(styles, /\.transferDelete::before/u);
  assert.match(styles, /place-items: center/u);
});

test("selected original files use the native share sheet with a safe fallback", () => {
  const enhancer = readFileSync(new URL("../app/transfer/qr-scanner-enhancer.tsx", import.meta.url), "utf8");
  assert.match(enhancer, /Mở hoặc lưu file gốc/u);
  assert.match(enhancer, /navigator\.canShare/u);
  assert.match(enhancer, /navigator\.share/u);
  assert.match(enhancer, /new File\(/u);
  assert.match(enhancer, /window\.open/u);
  assert.match(enhancer, /URL\.createObjectURL/u);
});

test("QR parser accepts only transfer links from the same origin", () => {
  const key = "AB12CD34EF56GH78IJ90KL12";
  const origin = "https://thue-ro.vercel.app";
  assert.equal(pairingKeyFromQr(`${origin}/transfer#pair=${key}`, origin), key);
  assert.equal(pairingKeyFromQr(`${origin}/transfer/#pair=${key}`, origin), key);
  assert.equal(pairingKeyFromQr(key, origin), key);
  assert.equal(pairingKeyFromQr(`https://example.com/transfer#pair=${key}`, origin), null);
  assert.equal(pairingKeyFromQr(`${origin}/other#pair=${key}`, origin), null);
  assert.equal(pairingKeyFromQr(`${origin}/transfer#pair=SHORT`, origin), null);
});

test("transferred documents reuse the main application reader structure", () => {
  const source = readFileSync(new URL("../app/transfer/page.tsx", import.meta.url), "utf8");
  assert.match(source, /className="documentDetail transferDocumentDetail"/u);
  assert.match(source, /className="detailHeader"/u);
  assert.match(source, /className="readerBlock"/u);
  assert.match(source, /className="readerText"/u);
  assert.match(source, /className="legalProvision"/u);
  assert.ok(source.includes("className={`legalBlock ${block.kind}"));
  assert.ok(source.includes("className={`audioDock ${audioVisible"));
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
