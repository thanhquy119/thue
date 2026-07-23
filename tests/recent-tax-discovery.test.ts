import assert from "node:assert/strict";
import test from "node:test";
import {
  CURRENT_TAX_DOCUMENT_NUMBERS,
  durableSourceFromDiscovery,
  selectExactOfficialSource,
} from "../lib/legal/recent-tax-discovery.ts";
import type { OnlineLegalSource } from "../lib/legal/types.ts";

function source(number: string, score: number, url = `https://datafiles.chinhphu.vn/${number}.pdf`): OnlineLegalSource {
  return {
    id: `source-${score}`,
    title: `Thông tư số ${number}: Quy định thử nghiệm về thuế`,
    url,
    snippet: "Cơ quan ban hành: Bộ Tài chính. Nội dung liên quan quản lý thuế.",
    score,
    source_label: "Công báo điện tử Chính phủ",
    previewable: true,
    document_number: number,
    document_type: "Thông tư",
    issuer: "Bộ Tài chính",
    issued_date: "2026-07-01",
  };
}

test("current tax seed includes document formats used by the ingestion matrix", () => {
  assert.ok(CURRENT_TAX_DOCUMENT_NUMBERS.includes("82/2026/TT-BTC"));
  assert.ok(CURRENT_TAX_DOCUMENT_NUMBERS.includes("87/2026/TT-BTC"));
  assert.ok(CURRENT_TAX_DOCUMENT_NUMBERS.includes("94/2026/TT-BTC"));
  assert.ok(CURRENT_TAX_DOCUMENT_NUMBERS.includes("97/2026/TT-BTC"));
});

test("selects only an exact number and keeps the highest official score", () => {
  const selected = selectExactOfficialSource("94/2026/TT-BTC", [
    source("94/2025/TT-BTC", 9),
    source("94/2026/TT-BTC", 3),
    source("94/2026/TT-BTC", 5, "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/7/94-btc.pdf"),
  ]);
  assert.equal(selected?.score, 5);
  assert.match(selected?.url ?? "", /94-btc\.pdf$/i);
});

test("maps official discovery metadata into a durable source", () => {
  const mapped = durableSourceFromDiscovery("87/2026/TT-BTC", source("87/2026/TT-BTC", 5));
  assert.equal(mapped.number, "87/2026/TT-BTC");
  assert.equal(mapped.type, "Thông tư");
  assert.equal(mapped.issuer, "Bộ Tài chính");
  assert.equal(mapped.issuedDate, "2026-07-01");
  assert.match(mapped.title, /Quy định thử nghiệm về thuế/i);
});
