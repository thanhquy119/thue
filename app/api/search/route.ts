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

function normalizeIdentifier(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("vi");
}

function fullIdentifier(query: string) {
  return query.match(FULL_IDENTIFIER_PATTERN)?.[0].replace(/\s+/g, "") ?? null;
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

async function validateRequestedIdentifier(query: string, identifier: string): Promise<TaxSearchResponse | null> {
  try {
    const discovery = await discoverOfficialSources(identifier);
    const exact = discovery.sources.some(
      (source) => source.document_number && normalizeIdentifier(source.document_number) === normalizeIdentifier(identifier),
    );
    if (exact) return null;

    const candidates = uniqueCandidates(discovery.sources).slice(0, 6);
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
        return NextResponse.json(invalidIdentifier, { headers: { "cache-control": "no-store" } });
      }
    }

    const result = await searchTaxLaw(rewriteNamedDocumentLookup(query));
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể tra cứu lúc này." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
