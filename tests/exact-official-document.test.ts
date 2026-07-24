import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalExactDocumentNumber,
  extractOfficialAttachmentUrls,
  parseExactGazettePayload,
  shouldQueueExactIngestion,
} from "../lib/legal/exact-official-document-core.ts";
import type { DurableIngestionState } from "../lib/legal/durable-ingestion-types.ts";

const EXACT_QUERY_CASES: Array<[string, string | null]> = [
  ["254/2026/NĐ-CP", "254/2026/NĐ-CP"],
  ["254/2026/ND-CP", "254/2026/NĐ-CP"],
  ["Nghị định 254 năm 2026", "254/2026/NĐ-CP"],
  ["nghi dinh so 254 nam 2026", "254/2026/NĐ-CP"],
  ["NĐ 254/2026", "254/2026/NĐ-CP"],
  ["nghị định số 254 của Chính phủ năm 2026", "254/2026/NĐ-CP"],
  ["Thông tư 90 năm 2026 Bộ Tài chính", "90/2026/TT-BTC"],
  ["TT 90/2026 BTC", "90/2026/TT-BTC"],
  ["90/2026/TT-BTC", "90/2026/TT-BTC"],
  ["thông tư số 91 của BTC năm 2026", "91/2026/TT-BTC"],
  ["108/2025/QH15", "108/2025/QH15"],
  ["Thông tư 90 năm 2026", null],
  ["Luật 108 năm 2025", null],
  ["Nghị quyết 12 năm 2026", null],
];

test("canonical exact-document parser handles accents, abbreviations and natural year placement", () => {
  for (const [query, expected] of EXACT_QUERY_CASES) {
    assert.equal(canonicalExactDocumentNumber(query), expected, query);
  }
});

test("Gazette payload accepts relative download endpoints and prioritizes DOCX", () => {
  const sources = parseExactGazettePayload("254/2026/NĐ-CP", {
    success: true,
    data: [
      {
        id_van_ban: 254,
        so_ky_hieu: "254/2026/NĐ-CP",
        loai_van_ban: "Nghị định",
        trich_yeu: "Quy định về hóa đơn điện tử, chứng từ điện tử",
        ngay_ban_hanh: "30/06/2026",
        ngay_hieu_luc: "01/07/2026",
        ten_co_quan: ["CHÍNH PHỦ"],
        duong_dan_chi_tiet: "/van-ban/nghi-dinh-so-254-2026-nd-cp-469957.htm",
        danh_sach_tep_van_ban: [
          {
            duong_dan: "/api/download/stream?Url=pdf-token&file_name=2026_402_254%2F2026%2FN%C4%90-CP.pdf",
            file_extension: "pdf",
          },
          {
            duong_dan: "/api/download/stream?Url=docx-token&file_name=2026_402_254%2F2026%2FN%C4%90-CP.docx",
            file_extension: "docx",
          },
        ],
      },
      {
        id_van_ban: 54,
        so_ky_hieu: "54/2026/NĐ-CP",
        danh_sach_tep_van_ban: [
          { duong_dan: "/api/download/stream?file_name=54-2026.pdf", file_extension: "pdf" },
        ],
      },
    ],
  });

  assert.ok(sources.length >= 2);
  assert.equal(sources[0].number, "254/2026/NĐ-CP");
  assert.match(decodeURIComponent(sources[0].sourceUrl), /\.docx/i);
  assert.equal(sources[0].issuedDate, "2026-06-30");
  assert.equal(sources[0].effectiveDate, "2026-07-01");
  assert.equal(sources[0].issuer, "CHÍNH PHỦ");
  assert.ok(sources.every((source) => source.number === "254/2026/NĐ-CP"));
  assert.ok(sources.every((source) => source.sourceUrl.startsWith("https://")));
});

test("official page attachment parser recognizes download query parameters without path extensions", () => {
  const html = `
    <a href="/viewer?id=254">Xem hồ sơ</a>
    <a href="/api/download/stream?Url=opaque-token&amp;file_name=254-ndcp.signed.pdf">PDF</a>
    <a href="/download?file=2026_402_254%2F2026%2FN%C4%90-CP.docx">DOCX</a>
    <iframe src="https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/07/254.signed.pdf"></iframe>
  `;
  const urls = extractOfficialAttachmentUrls(
    html,
    "https://vanban.chinhphu.vn/?classid=1&docid=218689&pageid=27160",
  );

  assert.equal(urls.length, 3);
  assert.match(decodeURIComponent(urls[0]), /\.docx/i);
  assert.ok(urls.some((url) => decodeURIComponent(url).includes("254-ndcp.signed.pdf")));
  assert.ok(urls.every((url) => !url.includes("viewer?id=254")));
});

function state(status: DurableIngestionState["status"], updatedAt: string): DurableIngestionState {
  return {
    number: "254/2026/NĐ-CP",
    status,
    stage: status === "processing" ? "queued" : "completed",
    runId: "job",
    sourceUrl: "https://congbao.chinhphu.vn/file.docx",
    extractionMethod: null,
    processedPages: 0,
    totalPages: 0,
    qualityScore: null,
    warnings: [],
    error: null,
    updatedAt,
  };
}

test("search-triggered ingestion is deduplicated and retries failed documents after cooldown", () => {
  const now = Date.parse("2026-07-24T12:00:00.000Z");
  assert.equal(shouldQueueExactIngestion(null, now), true);
  assert.equal(shouldQueueExactIngestion(state("processing", "2026-07-24T11:59:00.000Z"), now), false);
  assert.equal(shouldQueueExactIngestion(state("ready", "2026-07-20T00:00:00.000Z"), now), false);
  assert.equal(shouldQueueExactIngestion(state("failed", "2026-07-24T06:00:00.000Z"), now), false);
  assert.equal(shouldQueueExactIngestion(state("needs_review", "2026-07-23T20:00:00.000Z"), now), true);
  assert.equal(shouldQueueExactIngestion(state("failed", "invalid-date"), now), true);
});
