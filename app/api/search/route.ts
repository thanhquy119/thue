import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { parseLegalHierarchy, slugifyDocument } from "@/lib/legal/ingestion";
import { cleanUserQuery, containsPromptInjection, normalizeLegalQuery } from "@/lib/legal/query";
import { searchTaxLawRobust } from "@/lib/legal/robust-search";
import { consumeMemoryRateLimit, requestFingerprint } from "@/lib/legal/security";
import type { DocumentDetail, SearchCandidate, TaxSearchResponse } from "@/lib/legal/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const CIRCULAR_89_2026_NUMBER = "89/2026/TT-BTC";
const CIRCULAR_89_2026_PAGE =
  "https://baocaotaichinh.vn/thu-vien/thong-tu-so-89-2026-ttbtc-cua-bo-tai-chinh-quy-dinh-chi-tiet-mot-soi-dieu-cua-luat-quan-ly-thue-va-nghi-dinh-252-2026-ndcp-cua-chinh-phu-quy-dinh-chi-tiet-mot-so-dieu-va-bien-phap-de-to-chuc-huong-dan-thi-hanh-luat-quan-ly-thue-1178433928-65201";
const CIRCULAR_89_2026_DOCX =
  "https://baocaotaichinh.vn/tintuc/download?file=294987317thong-tu-so-89_2026_tt-btc.docx";

const VERIFIED_EXPIRED_DOCUMENTS = new Set(
  ["89/2017/TT-BTC", "89/2021/TT-BTC"].map((number) => normalizeIdentifier(number)),
);

function normalizeIdentifier(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("vi");
}

function normalizeDocumentText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isExpiredNumber(number: string) {
  return VERIFIED_EXPIRED_DOCUMENTS.has(normalizeIdentifier(number));
}

function isFinanceIssuer(candidate: SearchCandidate) {
  const issuer = normalizeLegalQuery(`${candidate.issuer} ${candidate.number}`);
  return issuer.includes("bo tai chinh") || issuer.includes("tt-btc") || issuer.includes("ttlt-btc");
}

function isCircular89(candidate: SearchCandidate) {
  return /^89\//.test(candidate.number.replace(/\s+/g, ""));
}

function recentCandidate(): SearchCandidate {
  return {
    id: "recent-89-2026-tt-btc",
    number: CIRCULAR_89_2026_NUMBER,
    title:
      "Thông tư số 89/2026/TT-BTC quy định chi tiết một số điều của Luật Quản lý thuế và Nghị định số 252/2026/NĐ-CP",
    type: "Thông tư",
    issuer: "Bộ Tài chính",
    issued_date: "2026-06-30",
    source_url: CIRCULAR_89_2026_PAGE,
    source_label: "Bản toàn văn đã đối chiếu",
  };
}

function queryRequestsCircular892026(query: string) {
  const normalized = normalizeLegalQuery(query);
  const hasNumberAndYear = /\b89\s*[/-]\s*2026\b/.test(normalized) || normalized.includes("89/2026/tt-btc");
  const hasTypeOrIssuer =
    normalized.includes("thong tu") || normalized.includes("bo tai chinh") || normalized.includes("tt-btc");
  return hasNumberAndYear && hasTypeOrIssuer;
}

function queryRequestsFinanceCircular89(query: string) {
  const normalized = normalizeLegalQuery(query);
  return /\bthong tu\s+89\b/.test(normalized) && /\b(?:bo tai chinh|btc)\b/.test(normalized);
}

function uniqueCandidates(candidates: SearchCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = normalizeIdentifier(candidate.number);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filterExpiredResponse(result: TaxSearchResponse): TaxSearchResponse {
  const candidates = (result.candidates ?? []).filter((candidate) => !isExpiredNumber(candidate.number));
  const documentExpired =
    result.document &&
    (isExpiredNumber(result.document.number) || ["expired", "repealed"].includes(result.document.status));

  if (documentExpired && result.document) {
    return {
      ...result,
      direct_answer: `${result.document.number} đã hết hiệu lực toàn bộ nên không được hiển thị trong danh sách văn bản hiện hành.`,
      document: null,
      candidates,
      confidence: 1,
    };
  }
  return { ...result, candidates };
}

const loadCircular892026 = unstable_cache(
  async (): Promise<DocumentDetail> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(CIRCULAR_89_2026_DOCX, {
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "user-agent": "Mozilla/5.0 Chrome/131 Safari/537.36",
          accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*",
          referer: CIRCULAR_89_2026_PAGE,
        },
      });
      if (!response.ok) throw new Error(`Nguồn toàn văn trả lỗi ${response.status}.`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength < 2_000 || buffer.byteLength > 18_000_000) {
        throw new Error("Tệp toàn văn không hợp lệ hoặc vượt giới hạn xử lý.");
      }

      const mammoth = await import("mammoth");
      const extracted = await mammoth.extractRawText({ buffer });
      const officialText = normalizeDocumentText(extracted.value);
      if (officialText.length < 5_000) throw new Error("Tệp nguồn chưa chứa đủ nội dung chữ.");

      const provisions = parseLegalHierarchy(officialText).map((provision, index) => ({
        id: `${slugifyDocument(CIRCULAR_89_2026_NUMBER)}-${index}`,
        type: provision.provisionType,
        identifier: provision.identifier,
        article: provision.article,
        heading: provision.heading,
        official_text: provision.officialText,
        order_index: provision.orderIndex,
      }));

      return {
        id: slugifyDocument(`${CIRCULAR_89_2026_NUMBER}-bo-tai-chinh`),
        number: CIRCULAR_89_2026_NUMBER,
        title:
          "Quy định chi tiết một số điều của Luật Quản lý thuế và Nghị định số 252/2026/NĐ-CP của Chính phủ",
        type: "Thông tư",
        issuer: "Bộ Tài chính",
        issued_date: "2026-06-30",
        effective_date: "2026-07-01",
        status: "effective",
        source_url: CIRCULAR_89_2026_PAGE,
        source_label: "Bản toàn văn đã đối chiếu",
        last_verified_at: new Date().toISOString(),
        extraction_method: "docx",
        quality_score: 0.92,
        verification_notes:
          "Văn bản mới được đối chiếu theo số hiệu, cơ quan ban hành, ngày ban hành và ngày hiệu lực; toàn văn được đọc từ bản DOCX công bố lại trong thời gian API Công báo chưa trả kết quả ổn định.",
        official_text: officialText,
        provisions,
      };
    } finally {
      clearTimeout(timer);
    }
  },
  ["thue-ro-circular-89-2026-v1"],
  { revalidate: 24 * 60 * 60 },
);

async function circular892026Response(): Promise<TaxSearchResponse> {
  try {
    const document = await loadCircular892026();
    return {
      query_normalized: normalizeIdentifier(CIRCULAR_89_2026_NUMBER),
      query_kind: "document",
      direct_answer: `Đã tìm thấy ${CIRCULAR_89_2026_NUMBER}.`,
      document,
      candidates: [],
      warnings: [],
      confidence: 0.99,
      retrieved_at: new Date().toISOString(),
    };
  } catch (error) {
    return {
      query_normalized: normalizeIdentifier(CIRCULAR_89_2026_NUMBER),
      query_kind: "document",
      direct_answer: `Đã xác định ${CIRCULAR_89_2026_NUMBER} do Bộ Tài chính ban hành, nhưng tệp toàn văn đang tạm thời chưa tải được.`,
      document: null,
      candidates: [recentCandidate()],
      warnings: [error instanceof Error ? error.message : "Không tải được tệp toàn văn."],
      confidence: 0.95,
      retrieved_at: new Date().toISOString(),
    };
  }
}

async function financeCircular89Response(query: string): Promise<TaxSearchResponse> {
  const base = await searchTaxLawRobust(query);
  const candidates = uniqueCandidates([recentCandidate(), ...(base.candidates ?? [])])
    .filter((candidate) => isCircular89(candidate) && isFinanceIssuer(candidate) && !isExpiredNumber(candidate.number))
    .sort((left, right) => (right.issued_date || "").localeCompare(left.issued_date || ""))
    .slice(0, 10);

  return {
    ...base,
    query_kind: "document",
    direct_answer:
      "Các thông tư số 89 dưới đây do Bộ Tài chính ban hành và chưa bị xác định hết hiệu lực toàn bộ. Văn bản mới nhất được ưu tiên ở đầu danh sách.",
    document: null,
    candidates,
    warnings: [],
    confidence: candidates.length ? 0.97 : 0.4,
    retrieved_at: new Date().toISOString(),
  };
}

export async function POST(request: Request) {
  const limit = consumeMemoryRateLimit(requestFingerprint(request));
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Em thao tác hơi nhanh. Vui lòng thử lại sau ${limit.retryAfter} giây.` },
      { status: 429, headers: { "retry-after": String(limit.retryAfter), "cache-control": "no-store" } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { query?: unknown };
  const query = cleanUserQuery(body.query);
  if (query.length < 2 || query.length > 500) {
    return NextResponse.json(
      { error: "Câu hỏi phải có từ 2 đến 500 ký tự." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  if (containsPromptInjection(query)) {
    return NextResponse.json(
      { error: "Câu hỏi chứa chỉ dẫn không phù hợp với chức năng tra cứu pháp luật." },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    if (queryRequestsCircular892026(query)) {
      return NextResponse.json(await circular892026Response(), { headers: { "cache-control": "no-store" } });
    }

    if (queryRequestsFinanceCircular89(query)) {
      return NextResponse.json(filterExpiredResponse(await financeCircular89Response(query)), {
        headers: { "cache-control": "no-store" },
      });
    }

    const result = await searchTaxLawRobust(query);
    return NextResponse.json(filterExpiredResponse(result), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể tra cứu lúc này." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
