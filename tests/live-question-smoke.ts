import assert from "node:assert/strict";
import { answerQuestionFromAnchors } from "../lib/legal/anchored-question.ts";
import { extractDurableLegalSource } from "../lib/legal/durable-extraction.ts";
import { validateDurableLegalText } from "../lib/legal/durable-ingestion-types.ts";
import { parseLegalHierarchy, slugifyDocument } from "../lib/legal/ingestion.ts";
import { recentVerifiedDocumentResponse } from "../lib/legal/recent-verified-documents.ts";
import { searchTaxLawRobust } from "../lib/legal/robust-search.ts";
import type { DocumentDetail, TaxSearchResponse } from "../lib/legal/types.ts";

const COMMIT_MARKER = "[live-questions]";
const enabled = process.env.RUN_LIVE_QUESTION_SMOKE === "true" ||
  (process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "").includes(COMMIT_MARKER);

const SOURCE_87_PAGE = "https://congbao.chinhphu.vn/van-ban/thong-tu-so-87-2026-tt-btc-470001.htm";
const SOURCE_87_DOCX = "https://g7.cdnchinhphu.vn/api/download/stream?Url=tm-8mq6BhNw0NbrKRhTDAaHMpvrqWaeHuYm7lW3HNfzTzww8Myg35dDL_fJB4izwRtXqUylC2raG8h7fhEFKbezii-VEYsFt-iPTKGmgi6kTIxcLK0Qk_OSX_B4ygRHWDpagyNhqy63GxmmCrjeBfQ~~&file_name=2026_420_87%2F2026%2FTT-BTC.docx";

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("vi")
    .trim();
}

async function retry<T>(label: string, operation: () => Promise<T>, attempts = 2) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.warn(`[live-question-retry] ${label} attempt=${attempt}`, error);
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }
  throw lastError;
}

function documentFromText(text: string, qualityScore: number): DocumentDetail {
  const provisions = parseLegalHierarchy(text).map((provision, index) => ({
    id: `87-2026-tt-btc-${index}`,
    type: provision.provisionType,
    identifier: provision.identifier,
    article: provision.article,
    heading: provision.heading,
    official_text: provision.officialText,
    order_index: provision.orderIndex,
  }));
  return {
    id: slugifyDocument("87/2026/TT-BTC-bo-tai-chinh"),
    number: "87/2026/TT-BTC",
    title: "Quy định chi tiết một số điều của Luật Thuế thu nhập cá nhân và Nghị định số 253/2026/NĐ-CP",
    type: "Thông tư",
    issuer: "Bộ Tài chính",
    issued_date: "2026-06-30",
    effective_date: "2026-07-01",
    status: "effective",
    source_url: SOURCE_87_PAGE,
    source_label: "Công báo điện tử Chính phủ",
    last_verified_at: new Date().toISOString(),
    extraction_method: "docx",
    quality_score: qualityScore,
    verification_notes: "Live smoke test từ DOCX Công báo chính thức.",
    official_text: text,
    provisions,
  };
}

function summarize(result: TaxSearchResponse) {
  return {
    queryKind: result.query_kind,
    directAnswer: result.direct_answer.slice(0, 1_200),
    documentNumber: result.document?.number ?? null,
    candidateNumbers: result.candidates.map((candidate) => candidate.number),
    warnings: result.warnings,
    confidence: result.confidence,
  };
}

async function assertRuleQuestion(query: string, pattern: RegExp) {
  const result = await searchTaxLawRobust(query);
  assert.equal(result.query_kind, "question");
  assert.match(normalized(result.direct_answer), pattern);
  assert.ok(result.confidence >= 0.6, `Confidence too low for verified question: ${query}`);
  console.log("[live-question-case]", JSON.stringify({ query, ...summarize(result) }));
}

async function main() {
  if (!enabled) {
    console.log(`[live-questions] skipped; add ${COMMIT_MARKER} to the commit message or set RUN_LIVE_QUESTION_SMOKE=true.`);
    return;
  }

  process.env.LEGAL_MAX_SOURCE_BYTES ||= "100000000";
  console.log("[live-questions] starting official-document question matrix");

  const source = await retry("87 official DOCX", () => extractDurableLegalSource(SOURCE_87_DOCX));
  assert.equal(source.extractionMethod, "docx");
  assert.ok(source.officialText.length > 5_000, "The official Circular 87 text is unexpectedly short.");
  const validation = validateDurableLegalText({
    expectedNumber: "87/2026/TT-BTC",
    issuedDate: "2026-06-30",
    text: source.officialText,
    extractionMethod: "docx",
    qualityScore: source.qualityScore,
  });
  console.log("[live-question-source]", JSON.stringify({
    number: "87/2026/TT-BTC",
    sourceUrl: source.sourceUrl,
    fileName: source.fileName,
    bytes: source.sourceBuffer.byteLength,
    characters: source.officialText.length,
    qualityScore: source.qualityScore,
    sha256: source.sha256,
    metadata: source.metadata,
    validation,
  }));
  assert.equal(validation.accepted, true, validation.warnings.join(" "));
  const document87 = documentFromText(source.officialText, source.qualityScore);

  const anchoredQuestions = [
    "Theo Thông tư 87/2026/TT-BTC, những khoản thu nhập nào được miễn thuế thu nhập cá nhân?",
    "Theo Thông tư 87/2026/TT-BTC, hồ sơ và nguyên tắc giảm trừ gia cảnh được quy định như thế nào?",
  ];
  for (const query of anchoredQuestions) {
    const result = await retry(query, () => answerQuestionFromAnchors(query, [document87]));
    assert.equal(result.document?.number, "87/2026/TT-BTC");
    assert.ok(result.direct_answer.length > 120);
    assert.match(normalized(result.direct_answer), /thue|giam tru|thu nhap/u);
    assert.doesNotMatch(normalized(result.direct_answer), /van ban gan giong/u);
    console.log("[live-question-case]", JSON.stringify({ query, ...summarize(result) }));
  }

  const circular94 = await recentVerifiedDocumentResponse("94/2026/TT-BTC");
  assert.ok(circular94);
  assert.equal(circular94?.document, null, "Circular 94 must not expose partial or fake full text before the durable run is ready.");
  assert.equal(circular94?.candidates[0]?.number, "94/2026/TT-BTC");
  assert.match(normalized(circular94?.warnings.join(" ") ?? ""), /pdf scan|ocr/u);
  console.log("[live-question-case]", JSON.stringify({ query: "94/2026/TT-BTC", ...summarize(circular94 as TaxSearchResponse) }));

  await assertRuleQuestion(
    "Hộ kinh doanh có doanh thu dưới 1 tỷ đồng có phải nộp thuế không và phải khai doanh thu thế nào từ năm 2026?",
    /doanh thu|khai|thue/u,
  );
  await assertRuleQuestion(
    "Tôi bán hàng trực tiếp cho người tiêu dùng thì có bắt buộc chỉ được dùng hóa đơn điện tử khởi tạo từ máy tính tiền không?",
    /hoa don|may tinh tien|khong/u,
  );
  await assertRuleQuestion(
    "Doanh nghiệp chuyển trụ sở sang tỉnh khác có phải đổi mã số thuế không?",
    /ma so thue|khong/u,
  );

  const repealQuery = "Thông tư 97/2026/TT-BTC bãi bỏ văn bản nào?";
  const repeal = await retry(repealQuery, () => searchTaxLawRobust(repealQuery), 2);
  assert.match(normalized(repeal.direct_answer), /55\/2010\/tt-btc/u);
  assert.ok(
    repeal.document?.number === "97/2026/TT-BTC" || repeal.candidates.some((candidate) => candidate.number === "97/2026/TT-BTC"),
    "The response must remain anchored to Circular 97.",
  );
  console.log("[live-question-case]", JSON.stringify({ query: repealQuery, ...summarize(repeal) }));

  console.log("[live-questions] official-document question matrix passed");
}

main().catch((error) => {
  console.error("[live-questions] failed", error);
  process.exitCode = 1;
});
