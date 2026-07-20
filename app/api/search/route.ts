import { NextResponse } from "next/server";
import { discoverOfficialSources } from "@/lib/legal/discovery";
import { cleanUserQuery, containsPromptInjection } from "@/lib/legal/query";
import { searchTaxLaw } from "@/lib/legal/search";
import { consumeMemoryRateLimit, requestFingerprint } from "@/lib/legal/security";
import type { OnlineLegalSource, SearchCandidate, TaxSearchResponse } from "@/lib/legal/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const FULL_IDENTIFIER_PATTERN = /\b\d{1,4}\s*\/\s*20\d{2}\s*\/\s*(?:NĐ-CP|ND-CP|TT-[A-ZĐ0-9-]+|NQ-[A-ZĐ0-9-]+|QĐ-[A-ZĐ0-9-]+|QD-[A-Z0-9-]+|QH\d*|UBTVQH\d*)\b/iu;

// Trạng thái đã được đối chiếu với CSDL quốc gia về văn bản pháp luật.
// Đây là lớp bảo vệ bổ sung khi nguồn Công báo không trả trường hiệu lực.
const VERIFIED_EXPIRED_DOCUMENTS = new Set([
  "89/2017/TT-BTC",
].map((number) => normalizeIdentifier(number)));

const VERIFIED_EFFECTIVE_DOCUMENTS = new Set([
  "89/2024/TT-BTC",
  "89/2021/TT-BTC",
  "89/2019/TT-BTC",
  "89/2016/TTLT-BTC-BCT",
].map((number) => normalizeIdentifier(number)));

const ISSUER_PATTERNS: Array<{ pattern: RegExp; issuer: string; code: string }> = [
  { pattern: /\b(?:bo tai chinh|btc)\b/, issuer: "Bộ Tài chính", code: "BTC" },
  { pattern: /\b(?:bo quoc phong|bqp)\b/, issuer: "Bộ Quốc phòng", code: "BQP" },
  { pattern: /\b(?:bo cong thuong|bct)\b/, issuer: "Bộ Công Thương", code: "BCT" },
  { pattern: /\b(?:bo tu phap|btp)\b/, issuer: "Bộ Tư pháp", code: "BTP" },
  { pattern: /\b(?:bo noi vu|bnv)\b/, issuer: "Bộ Nội vụ", code: "BNV" },
  { pattern: /\b(?:bo y te|byt)\b/, issuer: "Bộ Y tế", code: "BYT" },
  { pattern: /\b(?:bo giao duc va dao tao|bgddt)\b/, issuer: "Bộ Giáo dục và Đào tạo", code: "BGDĐT" },
  { pattern: /\b(?:bo cong an|bca)\b/, issuer: "Bộ Công an", code: "BCA" },
];

function normalizeIdentifier(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("vi");
}

function normalizeWords(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9/_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fullIdentifier(query: string) {
  return query.match(FULL_IDENTIFIER_PATTERN)?.[0].replace(/\s+/g, "") ?? null;
}

function identifierParts(identifier: string) {
  const match = identifier.match(/^(\d{1,4})\/(20\d{2})\/(.+)$/iu);
  if (!match) return null;
  const suffix = normalizeIdentifier(match[3]);
  const type = suffix.startsWith("tt-")
    ? "Thông tư"
    : suffix.startsWith("nd-")
      ? "Nghị định"
      : suffix.startsWith("nq-")
        ? "Nghị quyết"
        : suffix.startsWith("qd-")
          ? "Quyết định"
          : suffix.startsWith("qh") || suffix.startsWith("ubtvqh")
            ? "Luật"
            : "Văn bản";
  return { number: match[1], year: match[2], type };
}

function rewriteNamedDocumentLookup(query: string) {
  const match = query.match(
    /^\s*(luật|nghị định|thông tư|nghị quyết|quyết định)\s+(.+?)\s+(\d{1,4})(?:\s+(20\d{2}))?\s*$/iu,
  );
  if (!match || query.includes("?")) return query;
  const [, type, title, number, year] = match;
  return `${type} ${number}${year ? ` ${year}` : ""} ${title}`;
}

function sourceCandidate(source: OnlineLegalSource): SearchCandidate | null {
  const number = source.document_number?.trim();
  if (!number) return null;
  return {
    id: source.id,
    number: number.replace(/\s+/g, ""),
    title: source.title,
    type: source.document_type || "Văn bản pháp luật",
    issuer: source.issuer || "Chưa xác định cơ quan ban hành",
    issued_date: source.issued_date || null,
    source_url: source.url,
    source_label: source.source_label,
  };
}

function uniqueCandidates(sources: OnlineLegalSource[]) {
  const seen = new Set<string>();
  return sources.flatMap((source) => {
    const candidate = sourceCandidate(source);
    if (!candidate) return [];
    const key = normalizeIdentifier(candidate.number);
    if (seen.has(key)) return [];
    seen.add(key);
    return [candidate];
  });
}

function mergeSources(groups: OnlineLegalSource[][]) {
  const seen = new Set<string>();
  return groups.flatMap((group) => group).filter((source) => {
    const key = source.document_number ? normalizeIdentifier(source.document_number) : source.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isVerifiedExpiredNumber(number: string) {
  return VERIFIED_EXPIRED_DOCUMENTS.has(normalizeIdentifier(number));
}

function isVerifiedEffectiveNumber(number: string) {
  return VERIFIED_EFFECTIVE_DOCUMENTS.has(normalizeIdentifier(number));
}

function hasExplicitExpiredStatus(source: OnlineLegalSource) {
  // Chỉ đọc nhãn trạng thái. Không coi văn bản có trích yếu “bãi bỏ văn bản khác” là đã hết hiệu lực.
  const text = normalizeWords(source.snippet);
  return /\b(?:tinh trang hieu luc|trang thai|hieu luc)\s+het hieu luc toan bo\b/.test(text);
}

function candidateIsDisplayable(candidate: SearchCandidate) {
  return !isVerifiedExpiredNumber(candidate.number);
}

function sameNumberCandidate(candidate: SearchCandidate, number: string) {
  return new RegExp(`^${number}(?:/|$)`).test(normalizeIdentifier(candidate.number));
}

function issuerQualifiedLookup(query: string) {
  const normalized = normalizeWords(query);
  const issuerMatch = ISSUER_PATTERNS.find(({ pattern }) => pattern.test(normalized)) ?? null;
  const typeMatch = normalized.match(/\b(thong tu|nghi dinh|nghi quyet|quyet dinh|luat)\s+(\d{1,4})\b/);
  if (!issuerMatch || !typeMatch) return null;

  const type = typeMatch[1] === "thong tu"
    ? "Thông tư"
    : typeMatch[1] === "nghi dinh"
      ? "Nghị định"
      : typeMatch[1] === "nghi quyet"
        ? "Nghị quyết"
        : typeMatch[1] === "quyet dinh"
          ? "Quyết định"
          : "Luật";

  return { type, number: typeMatch[2], issuer: issuerMatch.issuer, issuerCode: issuerMatch.code };
}

function sourceMatchesIssuerLookup(source: OnlineLegalSource, lookup: NonNullable<ReturnType<typeof issuerQualifiedLookup>>) {
  const number = source.document_number || "";
  const type = normalizeWords(`${source.document_type || ""} ${source.title}`);
  const issuer = normalizeWords(`${source.issuer || ""} ${number}`);
  const expectedType = normalizeWords(lookup.type);
  const expectedIssuer = normalizeWords(lookup.issuer);

  return (
    new RegExp(`^${lookup.number}(?:/|$)`).test(normalizeIdentifier(number)) &&
    type.includes(expectedType) &&
    issuer.includes(expectedIssuer) &&
    !hasExplicitExpiredStatus(source) &&
    !isVerifiedExpiredNumber(number)
  );
}

function filterExpiredResponse(result: TaxSearchResponse): TaxSearchResponse {
  const candidates = (result.candidates ?? []).filter(candidateIsDisplayable);
  if (result.document && isVerifiedExpiredNumber(result.document.number)) {
    return {
      ...result,
      direct_answer: `${result.document.number} đã hết hiệu lực toàn bộ nên không được đưa vào danh sách văn bản hiện hành.`,
      document: null,
      candidates,
      confidence: 1,
    };
  }
  return { ...result, candidates };
}

async function searchIssuerQualifiedDocuments(query: string): Promise<TaxSearchResponse | null> {
  const lookup = issuerQualifiedLookup(query);
  if (!lookup) return null;

  const currentYear = new Date().getFullYear();
  const queries = [
    `${lookup.type} ${lookup.number}`,
    `${lookup.type} ${lookup.number} ${lookup.issuer}`,
  ];
  if (lookup.type === "Thông tư") {
    for (let offset = 0; offset <= 5; offset += 1) {
      queries.push(`${lookup.number}/${currentYear - offset}/TT-${lookup.issuerCode}`);
    }
  }

  const settled = await Promise.allSettled(queries.map((item) => discoverOfficialSources(item)));
  const sources = mergeSources(
    settled
      .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof discoverOfficialSources>>> => result.status === "fulfilled")
      .map((result) => result.value.sources),
  );
  const candidates = uniqueCandidates(sources.filter((source) => sourceMatchesIssuerLookup(source, lookup)))
    .filter(candidateIsDisplayable)
    .sort((left, right) => (right.issued_date || "").localeCompare(left.issued_date || ""))
    .slice(0, 10);
  const allVerifiedEffective = candidates.length > 0 && candidates.every((candidate) => isVerifiedEffectiveNumber(candidate.number));

  return {
    query_normalized: normalizeWords(query),
    query_kind: "document",
    direct_answer: candidates.length
      ? allVerifiedEffective
        ? `Các ${lookup.type.toLocaleLowerCase("vi")} số ${lookup.number} dưới đây do ${lookup.issuer} ban hành và còn hiệu lực.`
        : `Đã lọc các ${lookup.type.toLocaleLowerCase("vi")} số ${lookup.number} do ${lookup.issuer} ban hành và loại văn bản được xác định hết hiệu lực toàn bộ.`
      : `Không tìm thấy ${lookup.type.toLocaleLowerCase("vi")} số ${lookup.number} do ${lookup.issuer} ban hành còn hiệu lực trên nguồn pháp luật chính thức.`,
    document: null,
    candidates,
    warnings: [],
    confidence: candidates.length ? 0.95 : 0.4,
    retrieved_at: new Date().toISOString(),
  };
}

async function validateRequestedIdentifier(query: string, identifier: string): Promise<TaxSearchResponse | null> {
  try {
    const requested = identifierParts(identifier);
    const exactDiscovery = await discoverOfficialSources(identifier);
    const exact = exactDiscovery.sources.some(
      (source) => source.document_number && normalizeIdentifier(source.document_number) === normalizeIdentifier(identifier),
    );
    if (exact) return null;

    let alternativeSources = exactDiscovery.sources;
    if (requested) {
      const alternatives = await discoverOfficialSources(`${requested.type} ${requested.number}`);
      alternativeSources = [...alternatives.sources, ...exactDiscovery.sources];
    }

    const candidates = uniqueCandidates(
      alternativeSources.filter((source) => !hasExplicitExpiredStatus(source) && !isVerifiedExpiredNumber(source.document_number || "")),
    )
      .filter((candidate) => (!requested || sameNumberCandidate(candidate, requested.number)) && candidateIsDisplayable(candidate))
      .sort((left, right) => {
        const leftSameYear = left.number.includes(`/${requested?.year ?? ""}/`) ? 1 : 0;
        const rightSameYear = right.number.includes(`/${requested?.year ?? ""}/`) ? 1 : 0;
        if (leftSameYear !== rightSameYear) return rightSameYear - leftSameYear;
        return (right.issued_date || "").localeCompare(left.issued_date || "");
      })
      .slice(0, 6);

    return {
      query_normalized: normalizeIdentifier(query),
      query_kind: "document",
      direct_answer: `Không tìm thấy văn bản ${identifier} trên Công báo điện tử Chính phủ hoặc Hệ thống văn bản Chính phủ. Có thể số hiệu hoặc phần cơ quan ban hành chưa chính xác; hãy kiểm tra lại trước khi sử dụng.`,
      document: null,
      candidates,
      warnings: [],
      confidence: 0,
      retrieved_at: new Date().toISOString(),
    };
  } catch {
    return {
      query_normalized: normalizeIdentifier(query),
      query_kind: "document",
      direct_answer: `Không tìm thấy văn bản ${identifier} trên nguồn pháp luật chính thức. Hãy kiểm tra lại số hiệu, năm và cơ quan ban hành.`,
      document: null,
      candidates: [],
      warnings: [],
      confidence: 0,
      retrieved_at: new Date().toISOString(),
    };
  }
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
    const identifier = fullIdentifier(query);
    if (identifier) {
      const invalidIdentifier = await validateRequestedIdentifier(query, identifier);
      if (invalidIdentifier) {
        return NextResponse.json(filterExpiredResponse(invalidIdentifier), { headers: { "cache-control": "no-store" } });
      }
    }

    const issuerResult = await searchIssuerQualifiedDocuments(query);
    if (issuerResult) {
      return NextResponse.json(filterExpiredResponse(issuerResult), { headers: { "cache-control": "no-store" } });
    }

    const result = await searchTaxLaw(rewriteNamedDocumentLookup(query));
    return NextResponse.json(filterExpiredResponse(result), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể tra cứu lúc này." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
