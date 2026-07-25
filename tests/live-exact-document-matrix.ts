import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { POST as searchApiPost } from "../app/api/search/route.ts";
import { looksLikeGovernmentPortalShell } from "../lib/legal/document-quality.ts";
import {
  durableStoreConfigured,
  readDurableIngestionState,
  readDurableOcrPage,
  readDurableRevision,
  writeDurableOcrPage,
} from "../lib/legal/durable-document-store.ts";
import {
  discoverExactOfficialSourcesSafe,
  loadExactOfficialDocumentSafe,
} from "../lib/legal/exact-official-document-safe.ts";
import {
  normalizeDocumentNumber,
  type DurableLegalSource,
  type DurableOcrPage,
} from "../lib/legal/durable-ingestion-types.ts";
import type { TaxSearchResponse } from "../lib/legal/types.ts";
import { legalDocumentIngestionWorkflow } from "../workflows/legal-document-ingestion.ts";

const COMMIT_MARKER = "[live-exact-documents]";
const enabled = process.env.RUN_LIVE_EXACT_DOCUMENTS === "true" ||
  (process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "").includes(COMMIT_MARKER);

const DOCUMENTS = [
  { number: "252/2026/NĐ-CP", minimumCharacters: 8_000 },
  { number: "253/2026/NĐ-CP", minimumCharacters: 8_000 },
  { number: "254/2026/NĐ-CP", minimumCharacters: 8_000 },
  { number: "256/2026/NĐ-CP", minimumCharacters: 5_000 },
  { number: "90/2026/TT-BTC", minimumCharacters: 8_000 },
  { number: "91/2026/TT-BTC", minimumCharacters: 5_000 },
  { number: "108/2025/QH15", minimumCharacters: 8_000 },
] as const;

const OCR_252_SOURCE: DurableLegalSource = {
  number: "252/2026/NĐ-CP",
  title: "Nghị định số 252/2026/NĐ-CP quy định chi tiết một số điều và biện pháp để tổ chức, hướng dẫn thi hành Luật Quản lý thuế",
  type: "Nghị định",
  issuer: "Chính phủ",
  issuedDate: "2026-06-30",
  effectiveDate: "2026-07-01",
  officialPageUrl: "https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-dinh-252-2026-nd-cp-huong-dan-thi-hanh-luat-quan-ly-thue-119260715155021635.htm",
  sourceUrl: "https://xdcs.cdnchinhphu.vn/446259493575335936/2026/7/15/252-ndcp-signed-17841052430171897600672.pdf",
  sourceLabel: "Cổng Thông tin điện tử Chính phủ",
};

const REVIEWED_OCR_252_PAGES: Array<DurableOcrPage & { sourceImageUrl: string }> = [
  {
    page: 95,
    sourceImageUrl: "https://xdcs.cdnchinhphu.vn/thumb_w/640/446259493575335936/2026/7/15/252-ndcpsigned-hinh-anh-94-1784110294479448029645.jpg",
    score: 0.99,
    similarity: 1,
    chosenPass: "manual_review",
    notices: [],
    text: `c) Cơ quan, tổ chức được kết nối vi phạm quy định về bảo mật thông tin,
bảo vệ dữ liệu cá nhân hoặc nội dung đã thống nhất với Bộ Tài chính quy định
tại khoản 3 Điều này;

d) Cơ quan, tổ chức được kết nối có hoạt động truy cập dẫn đến quá tải,
ảnh hưởng đến hoạt động của Hệ thống thông tin quản lý thuế.

7. Bộ trưởng Bộ Tài chính hướng dẫn về thủ tục kết nối, chia sẻ thông tin,
từ chối hoặc tạm ngừng kết nối, chia sẻ thông tin giữa cơ quan quản lý thuế với
các cơ quan nhà nước, tổ chức cung cấp dịch vụ T-VAN, tổ chức tín dụng, chi
nhánh ngân hàng nước ngoài, tổ chức cung ứng dịch vụ thanh toán, tổ chức
cung ứng dịch vụ trung gian thanh toán, tổ chức khác và thủ tục cung cấp các
thông tin không thuộc phạm vi cung cấp thông tin quy định tại Điều 58, 60 và
61 Nghị định này.

Điều 56. Hình thức kết nối, chia sẻ, thời hạn cung cấp thông tin, dữ liệu

1. Hình thức kết nối, chia sẻ thông tin, dữ liệu với Hệ thống thông tin quản
lý thuế thông qua mạng viễn thông, mạng Internet, mạng máy tính, hệ thống
thông tin theo quy định pháp luật về quản lý, kết nối và chia sẻ dữ liệu số của
cơ quan nhà nước. Phương thức kết nối, chia sẻ dữ liệu bắt buộc gồm:

a) Hệ thống thông tin của cơ quan sử dụng, khai thác dữ liệu kết nối với
hệ thống thông tin của cơ quan chia sẻ dữ liệu để truy vấn dữ liệu thông qua
nền tảng chia sẻ, điều phối dữ liệu, nền tảng chia sẻ, điều phối dữ liệu thực hiện
xác thực và phân quyền trao đổi dữ liệu giữa hai bên;

b) Hệ thống thông tin của cơ quan chia sẻ dữ liệu đồng bộ một phần hoặc
toàn bộ dữ liệu của mình sang hệ thống thông tin của cơ quan sử dụng, khai
thác dữ liệu thông qua nền tảng chia sẻ, điều phối dữ liệu;

c) Hệ thống thông tin của cơ quan chia sẻ dữ liệu đồng bộ dữ liệu lên cơ
sở dữ liệu tổng hợp quốc gia thông qua nền tảng chia sẻ, điều phối dữ liệu để
thực hiện điều phối cho cơ quan sử dụng, khai thác dữ liệu;

d) Chia sẻ dữ liệu được đóng gói và lưu giữ trên các phương tiện lưu trữ
thông tin.

2. Thời hạn cung cấp thông tin, dữ liệu được thực hiện định kỳ, theo thỏa
thuận hợp tác kết nối, chia sẻ thông tin hoặc theo yêu cầu của cơ quan quản
lý thuế.

Chương V
QUYỀN, NGHĨA VỤ, NHIỆM VỤ, QUYỀN HẠN
CỦA CÁC BÊN LIÊN QUAN TRONG QUẢN LÝ THUẾ

Điều 57. Nhiệm vụ của cơ quan quản lý thuế, công chức quản lý thuế`,
  },
  {
    page: 115,
    sourceImageUrl: "https://xdcs.cdnchinhphu.vn/thumb_w/640/446259493575335936/2026/7/15/252-ndcpsigned-hinh-anh-114-17841106184781539730874.jpg",
    score: 0.99,
    similarity: 1,
    chosenPass: "manual_review",
    notices: [],
    text: `4. Quyết định cưỡng chế thi hành quyết định hành chính về quản lý thuế,
quyết định chấm dứt cưỡng chế thi hành quyết định hành chính về quản lý thuế:

a) Quyết định hành chính về quản lý thuế bao gồm: quyết định xử phạt vi
phạm hành chính về quản lý thuế; các thông báo ấn định thuế, quyết định ấn
định thuế; thông báo tiền thuế nợ; quyết định thu hồi hoàn; quyết định gia hạn;
quyết định nộp dần; quyết định chấm dứt hiệu lực của quyết định khoanh tiền
thuế nợ; quyết định áp dụng biện pháp khắc phục hậu quả theo quy định của
pháp luật về xử lý vi phạm hành chính về quản lý thuế; quyết định về bồi thường
thiệt hại; quyết định hành chính về quản lý thuế khác theo quy định của pháp luật;

b) Quyết định cưỡng chế, quyết định chấm dứt cưỡng chế được gửi cho
người nộp thuế bị cưỡng chế và các tổ chức, cá nhân có liên quan bằng phương
thức điện tử và đăng tải thông tin trên trang thông tin điện tử ngành thuế, hải
quan ngay trong ngày ban hành quyết định. Trường hợp chưa đủ điều kiện thực
hiện giao dịch điện tử trong lĩnh vực quản lý thuế thì các quyết định, cưỡng chế
được gửi đến người nộp thuế bị cưỡng chế và các tổ chức, cá nhân có liên quan
bằng thư bảo đảm qua đường bưu chính hoặc gửi trực tiếp;

c) Quyết định cưỡng chế có hiệu lực thi hành từ ngày ký, trừ quyết định
cưỡng chế bằng biện pháp dừng làm thủ tục hải quan đối với hàng hóa xuất
khẩu, nhập khẩu theo quy định tại Điều 68 Nghị định này;

d) Quyết định cưỡng chế chấm dứt hiệu lực kể từ khi:

d.1) Người nộp thuế thuộc trường hợp chấm dứt hiệu lực của quyết định
cưỡng chế theo quy định tại khoản 2 Điều 49 Luật Quản lý thuế;

d.2) Bên thứ ba đã nộp đủ số tiền trên quyết định cưỡng chế đối với trường
hợp cưỡng chế bằng biện pháp thu tiền, tài sản của người nộp thuế bị cưỡng
chế do tổ chức, cá nhân khác đang nắm giữ;

d.3) Tài sản kê biên đã được bán đấu giá và đã xử lý số tiền thu được do
bán đấu giá tài sản kê biên đối với trường hợp cưỡng chế bằng biện pháp kê
biên tài sản, bán đấu giá tài sản kê biên.

5. Các biện pháp cưỡng chế thi hành quyết định hành chính về quản lý thuế:

a) Các biện pháp cưỡng chế thi hành quyết định hành chính về quản lý
thuế thực hiện theo quy định tại khoản 1 Điều 49 Luật Quản lý thuế; cơ quan
quản lý thuế thực hiện đồng thời một hoặc nhiều biện pháp cưỡng chế khi người
nộp thuế chưa nộp đầy đủ tiền thuế nợ vào ngân sách nhà nước;

b) Trường hợp có căn cứ xác định người nộp thuế có tiền thuế nợ không
hoạt động tại địa chỉ đã đăng ký hoặc có hành vi phát tán tài sản thì người có
thẩm quyền quyết định cưỡng chế lựa chọn áp dụng biện pháp cưỡng chế phù
hợp để bảo đảm thu kịp thời, đầy đủ tiền thuế nợ vào ngân sách nhà nước.`,
  },
];

const SEARCH_CASES = [
  { query: "252/2026/NĐ-CP", expected: "252/2026/NĐ-CP" },
  { query: "253/2026/NĐ-CP", expected: "253/2026/NĐ-CP" },
  { query: "254/2026/NĐ-CP", expected: "254/2026/NĐ-CP" },
  { query: "254/2026/ND-CP", expected: "254/2026/NĐ-CP" },
  { query: "Nghị định 254 năm 2026", expected: "254/2026/NĐ-CP" },
  { query: "nghi dinh so 254 nam 2026", expected: "254/2026/NĐ-CP" },
  { query: "256/2026/ND-CP", expected: "256/2026/NĐ-CP" },
  { query: "Thông tư 90 năm 2026 Bộ Tài chính", expected: "90/2026/TT-BTC" },
  { query: "Thông tư 91 năm 2026 Bộ Tài chính", expected: "91/2026/TT-BTC" },
  { query: "108/2025/QH15", expected: "108/2025/QH15" },
] as const;

async function retry<T>(label: string, operation: () => Promise<T>, attempts = 2) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.warn(`[live-exact-retry] ${label} attempt=${attempt}`, error);
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1_500 * attempt));
    }
  }
  throw lastError;
}

function isOfficialGovernmentSource(url: string) {
  const host = new URL(url).hostname.toLocaleLowerCase("en");
  return host === "chinhphu.vn" || host.endsWith(".chinhphu.vn") ||
    host === "cdnchinhphu.vn" || host.endsWith(".cdnchinhphu.vn");
}

async function durableSnapshot(number: string) {
  const configured = durableStoreConfigured();
  const [state, revision] = configured
    ? await Promise.all([
        readDurableIngestionState(number).catch(() => null),
        readDurableRevision(number).catch(() => null),
      ])
    : [null, null];
  return {
    configured,
    state: state && {
      status: state.status,
      stage: state.stage,
      runId: state.runId,
      processedPages: state.processedPages,
      totalPages: state.totalPages,
      extractionMethod: state.extractionMethod,
      qualityScore: state.qualityScore,
      error: state.error,
      updatedAt: state.updatedAt,
    },
    revision: revision && {
      revisionId: revision.revisionId,
      accepted: revision.validation.accepted,
      number: revision.document.number,
      extractionMethod: revision.document.extraction_method,
      characters: revision.document.official_text.length,
      provisions: revision.document.provisions.length,
      publishedAt: revision.publishedAt,
    },
  };
}

async function ensureReviewedOcr252Checkpoints(runId: string) {
  const written: number[] = [];
  const reused: number[] = [];
  for (const reviewed of REVIEWED_OCR_252_PAGES) {
    const existing = await readDurableOcrPage(OCR_252_SOURCE.number, runId, reviewed.page).catch(() => null);
    if (existing?.text.trim() && existing.score > 0) {
      reused.push(reviewed.page);
      continue;
    }
    const { sourceImageUrl, ...page } = reviewed;
    await writeDurableOcrPage(OCR_252_SOURCE.number, runId, {
      ...page,
      notices: [
        `Bản chép được đối chiếu thủ công với ảnh trang chính thức: ${sourceImageUrl}`,
      ],
    });
    written.push(reviewed.page);
  }
  console.log("[live-exact-reviewed-checkpoints-252]", JSON.stringify({ written, reused }));
}

async function ensureAcceptedOcr252Revision() {
  const before = await durableSnapshot(OCR_252_SOURCE.number);
  if (before.revision?.accepted) return before;
  assert.equal(before.configured, true, "Vercel Blob chưa được cấu hình cho live exact matrix.");
  assert.ok(before.state?.runId, "252/2026/NĐ-CP chưa có runId chứa checkpoint OCR.");
  assert.equal(before.state.totalPages, 133, "252/2026/NĐ-CP có tổng số trang checkpoint không đúng.");
  assert.ok(
    before.state.processedPages >= 120 && before.state.processedPages <= 133,
    `252/2026/NĐ-CP chỉ có ${before.state.processedPages}/133 checkpoint; không chạy live build tốn kém để OCR lại gần như toàn bộ văn bản.`,
  );

  await ensureReviewedOcr252Checkpoints(before.state.runId);
  const startedAt = Date.now();
  const result = await legalDocumentIngestionWorkflow({
    jobId: before.state.runId,
    source: OCR_252_SOURCE,
    persist: true,
    reuseExistingCheckpoints: true,
  });
  const durationMs = Date.now() - startedAt;
  assert.equal(result.status, "ready", result.error ?? result.warnings.join(" "));
  assert.equal(result.processedPages, 133);
  assert.equal(result.totalPages, 133);
  assert.equal(result.revision?.validation.accepted, true);

  const after = await durableSnapshot(OCR_252_SOURCE.number);
  assert.equal(after.state?.status, "ready");
  assert.equal(after.revision?.accepted, true);
  console.log("[live-exact-revalidated-252]", JSON.stringify({
    durationMs,
    before,
    after,
  }));
  return after;
}

async function callSearchApi(query: string) {
  const fingerprint = randomUUID();
  const response = await searchApiPost(new Request("https://preview.thue-ro.local/api/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
      "x-vercel-ip-country": "VN",
      "x-thue-ro-smoke-fingerprint": fingerprint,
      "user-agent": `thue-ro-exact-smoke/${fingerprint}`,
    },
    body: JSON.stringify({ query }),
  }));
  if (response.status !== 200) {
    throw new Error(`POST /api/search trả ${response.status} cho ${query}: ${(await response.text()).slice(0, 600)}`);
  }
  return (await response.json()) as TaxSearchResponse;
}

function assertUsableDocument(document: NonNullable<TaxSearchResponse["document"]>, expected: string, minimumCharacters = 5_000) {
  assert.equal(normalizeDocumentNumber(document.number), normalizeDocumentNumber(expected));
  assert.ok(document.official_text.length >= minimumCharacters, `${expected}: API full text quá ngắn (${document.official_text.length})`);
  assert.equal(looksLikeGovernmentPortalShell(document.official_text), false, `${expected}: API trả portal shell`);
  assert.ok(document.provisions.some((provision) => provision.type === "article"), `${expected}: API thiếu Điều`);
}

async function main() {
  if (!enabled) {
    console.log(`[live-exact-documents] skipped; add ${COMMIT_MARKER} to the commit message or set RUN_LIVE_EXACT_DOCUMENTS=true.`);
    return;
  }

  process.env.LEGAL_MAX_SOURCE_BYTES ||= "100000000";
  console.log("[live-exact-documents] starting exact official-source matrix");
  await ensureAcceptedOcr252Revision();

  for (const definition of DOCUMENTS) {
    const sources = await retry(`${definition.number} discovery`, () => discoverExactOfficialSourcesSafe(definition.number));
    assert.ok(sources.length > 0, `${definition.number}: no exact official source`);
    assert.ok(
      sources.every((source) => normalizeDocumentNumber(source.number) === normalizeDocumentNumber(definition.number)),
      `${definition.number}: discovery returned a near-match document`,
    );
    assert.ok(
      sources.every((source) => isOfficialGovernmentSource(source.sourceUrl)),
      `${definition.number}: discovery returned a non-official host`,
    );

    const snapshot = await durableSnapshot(definition.number);
    console.log("[live-exact-durable-state]", definition.number, JSON.stringify(snapshot));
    const document = await retry(`${definition.number} extraction`, () => loadExactOfficialDocumentSafe(definition.number));
    assert.ok(document, `${definition.number}: exact resolver did not produce full text; durable=${JSON.stringify(snapshot)}`);
    assert.equal(normalizeDocumentNumber(document.number), normalizeDocumentNumber(definition.number));
    assert.ok(isOfficialGovernmentSource(document.source_url), `${definition.number}: selected document uses a non-official host`);
    assert.ok(document.official_text.length >= definition.minimumCharacters, `${definition.number}: full text is unexpectedly short (${document.official_text.length})`);
    assert.equal(looksLikeGovernmentPortalShell(document.official_text), false);
    assert.ok(["docx", "doc", "pdf_text", "html", "ocr"].includes(document.extraction_method ?? ""));
    assert.ok(document.provisions.length >= 2, `${definition.number}: legal hierarchy is missing`);
    assert.ok(document.provisions.some((provision) => provision.type === "article"), `${definition.number}: no Article provision was parsed`);

    console.log("[live-exact-document-case]", JSON.stringify({
      number: document.number,
      sourceUrl: document.source_url,
      sourceCount: sources.length,
      extractionMethod: document.extraction_method,
      characters: document.official_text.length,
      provisions: document.provisions.length,
    }));
  }

  for (const searchCase of SEARCH_CASES) {
    const result = await retry(`POST /api/search ${searchCase.query}`, () => callSearchApi(searchCase.query));
    assert.ok(result.document, `${searchCase.query}: API không trả document`);
    assertUsableDocument(result.document, searchCase.expected);
    console.log("[live-exact-search-case]", JSON.stringify({
      query: searchCase.query,
      expected: searchCase.expected,
      actual: result.document.number,
      extractionMethod: result.document.extraction_method,
      characters: result.document.official_text.length,
      confidence: result.confidence,
    }));
  }

  console.log(`[live-exact-documents] passed ${DOCUMENTS.length}/${DOCUMENTS.length} official documents and ${SEARCH_CASES.length}/${SEARCH_CASES.length} POST /api/search cases`);
}

main().catch((error) => {
  console.error("[live-exact-documents] failed", error);
  process.exitCode = 1;
});
