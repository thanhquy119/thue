import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseLatestGovernmentTaxDocuments } from "../lib/legal/latest-government-tax-feed.ts";
import { mergeDocumentWithOfficialSources } from "../lib/legal/official-document-metadata-fetch.ts";
import {
  extractOfficialMetadataFromText,
  inferEffectiveDateFromLegalText,
  mergeOfficialDocumentMetadata,
  parseOfficialDate,
} from "../lib/legal/official-document-metadata.ts";
import type { DurableLegalSource } from "../lib/legal/durable-ingestion-types.ts";
import type { DocumentDetail } from "../lib/legal/types.ts";

function document(patch: Partial<DocumentDetail> = {}): DocumentDetail {
  return {
    id: "253-2026",
    number: "253/2026/NĐ-CP",
    title: "253/2026/NĐ-CP 30/06/2026",
    type: "Nghị định",
    issuer: "Chính phủ",
    issued_date: "2026-06-30",
    effective_date: null,
    status: "unknown",
    source_url: "https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-253-2026-nd-cp-469959.htm",
    source_label: "Công báo điện tử Chính phủ",
    last_verified_at: "2026-07-27T00:00:00.000Z",
    extraction_method: "pdf_text",
    quality_score: 0.99,
    verification_notes: null,
    official_text:
      "Điều 38. Hiệu lực thi hành. Nghị định này có hiệu lực thi hành từ ngày 01 tháng 7 năm 2026.",
    provisions: [],
    ...patch,
  };
}

test("normalizes official numeric and Vietnamese dates", () => {
  assert.equal(parseOfficialDate("01/07/2026"), "2026-07-01");
  assert.equal(parseOfficialDate("ngày 1 tháng 7 năm 2026"), "2026-07-01");
  assert.equal(parseOfficialDate("31/02/2026"), null);
});

test("extracts issued date, effective date and abstract from an official page", () => {
  const metadata = extractOfficialMetadataFromText(
    "Số ký hiệu 253/2026/NĐ-CP | Ngày ban hành: 30/06/2026 | Ngày có hiệu lực: 01/07/2026 | Trích yếu: Quy định chi tiết một số điều và biện pháp để tổ chức, hướng dẫn thi hành Luật Thuế thu nhập cá nhân | Tài liệu đính kèm",
    "253/2026/NĐ-CP",
  );
  assert.equal(metadata.issuedDate, "2026-06-30");
  assert.equal(metadata.effectiveDate, "2026-07-01");
  assert.match(metadata.title ?? "", /Luật Thuế thu nhập cá nhân/iu);
});

test("the direct Government listing keeps both issuance and effectivity metadata", () => {
  const documents = parseLatestGovernmentTaxDocuments(`
    <div>
      <span>253/2026/NĐ-CP</span>
      <span>Ngày ban hành: 30/06/2026</span>
      <span>Ngày có hiệu lực: 01/07/2026</span>
      <a href="/?classid=1&docid=218684">Quy định chi tiết một số điều về thuế thu nhập cá nhân</a>
    </div>
  `);
  assert.equal(documents[0]?.issuedDate, "2026-06-30");
  assert.equal(documents[0]?.effectiveDate, "2026-07-01");
});

test("infers effectivity from the document own enforcement clause", () => {
  assert.equal(
    inferEffectiveDateFromLegalText(
      "Nghị định số 65/2013/NĐ-CP có hiệu lực từ ngày 01/07/2013. Điều 38. Nghị định này có hiệu lực thi hành từ ngày 01 tháng 7 năm 2026.",
      "2026-06-30",
    ),
    "2026-07-01",
  );
});

test("uses issuance date when the document takes effect from the signing date", () => {
  assert.equal(
    inferEffectiveDateFromLegalText(
      "Điều 10. Hiệu lực thi hành. Quyết định này có hiệu lực kể từ ngày ký.",
      "2026-07-28",
    ),
    "2026-07-28",
  );
});

test("merges reliable official metadata into the most complete stored revision", () => {
  const content = document();
  const metadata = document({
    title:
      "Nghị định số 253/2026/NĐ-CP quy định chi tiết một số điều và biện pháp để tổ chức, hướng dẫn thi hành Luật Thuế thu nhập cá nhân",
    effective_date: "2026-07-01",
    status: "effective",
    official_text: "Điều 1.",
    quality_score: 0.6,
  });
  const merged = mergeOfficialDocumentMetadata(content, [metadata]);
  assert.equal(merged.effective_date, "2026-07-01");
  assert.equal(merged.status, "effective");
  assert.match(merged.title, /Luật Thuế thu nhập cá nhân/iu);
  assert.equal(merged.official_text, content.official_text);
});

test("resolves metadata by document number when the stored revision points directly to a file", () => {
  const content = document({
    id: "178-2026",
    number: "178/2026/NĐ-CP",
    title: "Nghị định 178/2026/NĐ-CP",
    issued_date: null,
    effective_date: null,
    status: "unknown",
    source_url: "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/5/178-ndcp.signed.pdf",
    source_label: "Tệp PDF chính thức",
    official_text: "Điều 1. Phạm vi điều chỉnh. Điều 2. Đối tượng áp dụng.",
  });
  const sources: DurableLegalSource[] = [{
    number: "178/2026/NĐ-CP",
    title:
      "Nghị định số 178/2026/NĐ-CP quy định việc quản lý, sử dụng và khai thác tài sản kết cấu hạ tầng do Nhà nước đầu tư, quản lý",
    type: "Nghị định",
    issuer: "Chính phủ",
    issuedDate: "2026-05-20",
    effectiveDate: "2026-07-06",
    officialPageUrl: "https://vanban.chinhphu.vn/?classid=1&docid=218194&orggroupid=2&pageid=27160",
    sourceUrl: "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/5/178-ndcp.signed.pdf",
    sourceLabel: "Cổng Thông tin điện tử Chính phủ",
  }];

  const merged = mergeDocumentWithOfficialSources(content, sources);
  assert.equal(merged.issued_date, "2026-05-20");
  assert.equal(merged.effective_date, "2026-07-06");
  assert.equal(merged.status, "effective");
  assert.match(merged.title, /tài sản kết cấu hạ tầng/iu);
  assert.match(merged.source_url, /docid=218194/u);
  assert.equal(merged.official_text, content.official_text);
});

test("natural exact-document lookups merge content and official metadata before caching", () => {
  const source = readFileSync(
    new URL("../lib/legal/exact-official-document-safe.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /mergeOfficialDocumentMetadata\(content, candidates\)/u);
  assert.match(source, /enrichDocumentWithOfficialMetadata\(merged\)/u);
  assert.match(source, /thue-ro-exact-official-document-safe-v12/u);
});

test("does not overwrite a verified repealed status merely because an effective date exists", () => {
  const merged = mergeOfficialDocumentMetadata(
    document({ status: "repealed" }),
    [document({ effective_date: "2026-07-01", status: "effective" })],
  );
  assert.equal(merged.status, "repealed");
});
