import { createHash } from "node:crypto";
import type { DurableLegalSource } from "./durable-ingestion-types.ts";
import {
  extractOfficialMetadataFromText,
  parseOfficialDate,
} from "./official-document-metadata.ts";

const LATEST_GOVERNMENT_DOCUMENTS_URL =
  "https://vanban.chinhphu.vn/he-thong-van-ban?classid=1&mode=1&orggroupid=2";
const DOCUMENT_NUMBER =
  /\b\d{1,4}(?:\.\d+)?\s*\/\s*20\d{2}\s*\/\s*(?:NĐ-CP|ND-CP|TT-BTC|NQ-CP|QĐ-TTg|QH\d*|UBTVQH\d*)\b/iu;
const TAX_TOPIC =
  /(?:thuế|hóa đơn|lệ phí|phí|hải quan|quản lý thuế|đăng ký thuế|mã số thuế|giao dịch liên kết|chống rửa tiền|trao đổi thông tin theo yêu cầu về thuế)/iu;

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (_match, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLocaleLowerCase("en")] ?? `&${entity};`;
  });
}

function stripTags(value: string) {
  return decodeHtml(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<[^>]+>/gu, " "),
  )
    .replace(/\s+/gu, " ")
    .trim();
}

function inferFirstDate(value: string) {
  const match = value.match(/\b\d{1,2}[/.\-]\d{1,2}[/.\-]20\d{2}\b/u);
  return match ? parseOfficialDate(match[0]) : null;
}

function inferType(number: string) {
  if (/\/NĐ-CP$/iu.test(number)) return "Nghị định";
  if (/\/TT-BTC$/iu.test(number)) return "Thông tư";
  if (/\/NQ-CP$/iu.test(number)) return "Nghị quyết";
  if (/\/QĐ-TTg$/iu.test(number)) return "Quyết định";
  if (/\/(?:QH\d*|UBTVQH\d*)$/iu.test(number)) return "Luật";
  return "Văn bản pháp luật";
}

function inferIssuer(number: string) {
  if (/\/TT-BTC$/iu.test(number)) return "Bộ Tài chính";
  if (/\/(?:NĐ-CP|NQ-CP)$/iu.test(number)) return "Chính phủ";
  if (/\/QĐ-TTg$/iu.test(number)) return "Thủ tướng Chính phủ";
  if (/\/(?:QH\d*|UBTVQH\d*)$/iu.test(number)) return "Quốc hội";
  return "";
}

export function parseLatestGovernmentTaxDocuments(
  html: string,
  baseUrl = LATEST_GOVERNMENT_DOCUMENTS_URL,
): DurableLegalSource[] {
  const documents: DurableLegalSource[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(
    /<a\b[^>]*href=["']([^"']*(?:docid|docId)=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/giu,
  )) {
    let officialPageUrl: string;
    try {
      officialPageUrl = new URL(decodeHtml(match[1]), baseUrl).toString();
      if (!new URL(officialPageUrl).hostname.endsWith("chinhphu.vn")) continue;
    } catch {
      continue;
    }

    const start = Math.max(0, (match.index ?? 0) - 500);
    const end = Math.min(html.length, (match.index ?? 0) + match[0].length + 1_500);
    const surrounding = stripTags(html.slice(start, end));
    const anchor = stripTags(match[2]);
    const combined = `${anchor} ${surrounding}`;
    const number = combined.match(DOCUMENT_NUMBER)?.[0]?.replace(/\s+/gu, "") ?? "";
    if (!number || seen.has(number.toLocaleLowerCase("vi")) || !TAX_TOPIC.test(combined)) continue;

    seen.add(number.toLocaleLowerCase("vi"));
    const type = inferType(number);
    const officialMetadata = extractOfficialMetadataFromText(combined, number);
    const title = officialMetadata.title ?? (anchor && !anchor.includes(number)
      ? anchor
      : surrounding
          .replace(new RegExp(`^.*?${number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "iu"), "")
          .split(/(?:Ngày ban hành|Ngày có hiệu lực|Ngày hiệu lực|Tài liệu đính kèm)/iu, 1)[0]
          ?.trim() || `Văn bản số ${number}`);

    documents.push({
      number,
      title,
      type,
      issuer: inferIssuer(number),
      issuedDate: officialMetadata.issuedDate ?? inferFirstDate(combined),
      effectiveDate: officialMetadata.effectiveDate,
      officialPageUrl,
      sourceUrl: officialPageUrl,
      sourceLabel: "Danh sách văn bản mới nhất của Chính phủ",
    });
  }

  return documents.slice(0, 20);
}

export async function discoverLatestGovernmentTaxDocuments() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(LATEST_GOVERNMENT_DOCUMENTS_URL, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "user-agent": "Thuế Rõ legal discovery/1.0",
        "accept-language": "vi-VN,vi;q=0.9",
      },
    });
    if (!response.ok) {
      throw new Error(`Danh sách văn bản Chính phủ trả HTTP ${response.status}.`);
    }
    return parseLatestGovernmentTaxDocuments(await response.text());
  } finally {
    clearTimeout(timer);
  }
}

export function latestGovernmentDocumentFingerprint(documents: DurableLegalSource[]) {
  return createHash("sha256")
    .update(documents.map((document) => document.number).sort().join("\n"))
    .digest("hex");
}
