import type { DocumentDetail, OnlineLegalSource, SearchCandidate } from "./types";

export type LegalUpdateRelationKind = "replacement" | "amendment" | "repeal";

export type LegalUpdateRelation = {
  kind: LegalUpdateRelationKind;
  source: OnlineLegalSource;
  documentNumber: string;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9/_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: string) {
  return normalize(value).replace(/\s+/g, "");
}

export function sourceDocumentNumber(source: OnlineLegalSource) {
  const explicit = source.document_number?.trim();
  if (explicit) return explicit.replace(/\s+/g, "");
  return (
    source.title.match(
      /\b\d{1,4}\s*\/\s*20\d{2}\s*\/\s*(?:NĐ-CP|ND-CP|TT-[A-ZĐ0-9-]+|NQ-[A-ZĐ0-9-]+|QĐ-[A-ZĐ0-9-]+|QD-[A-Z0-9-]+|QH\d*|UBTVQH\d*)\b/iu,
    )?.[0]?.replace(/\s+/g, "") ?? ""
  );
}

function relationWindow(documentNumber: string, source: OnlineLegalSource) {
  const text = compact(`${source.title} ${source.snippet}`);
  const target = compact(documentNumber);
  const index = text.indexOf(target);
  if (index < 0) return "";
  return text.slice(Math.max(0, index - 260), index + target.length + 260);
}

export function relationKindForSource(documentNumber: string, source: OnlineLegalSource): LegalUpdateRelationKind | null {
  const window = relationWindow(documentNumber, source);
  if (!window) return null;
  if (/(?:duoc)?thaythe|thaythe(?:toanbo)?/.test(window)) return "replacement";
  if (/suadoi|bosung|dinhchinh/.test(window)) return "amendment";
  if (/baibo|hethieuluc/.test(window)) return "repeal";
  return null;
}

function yearFromNumber(number: string) {
  const match = number.match(/\/(20\d{2})(?:\/|$)/);
  return match ? Number(match[1]) : 0;
}

function isNewerThanDocument(document: DocumentDetail, source: OnlineLegalSource, sourceNumber: string) {
  if (source.issued_date && document.issued_date) return source.issued_date > document.issued_date;
  const sourceYear = Number(source.issued_date?.slice(0, 4)) || yearFromNumber(sourceNumber);
  const documentYear = Number(document.issued_date?.slice(0, 4)) || yearFromNumber(document.number);
  return Boolean(sourceYear && documentYear && sourceYear > documentYear);
}

const relationPriority: Record<LegalUpdateRelationKind, number> = {
  replacement: 3,
  amendment: 2,
  repeal: 1,
};

export function findLatestLegalUpdate(
  document: DocumentDetail,
  sources: OnlineLegalSource[],
): LegalUpdateRelation | null {
  const originalNumber = compact(document.number);
  return (
    sources
      .map((source) => {
        const documentNumber = sourceDocumentNumber(source);
        const kind = relationKindForSource(document.number, source);
        if (!documentNumber || compact(documentNumber) === originalNumber || !kind) return null;
        if (!isNewerThanDocument(document, source, documentNumber)) return null;
        return { kind, source, documentNumber } satisfies LegalUpdateRelation;
      })
      .filter((item): item is LegalUpdateRelation => Boolean(item))
      .sort(
        (left, right) =>
          (right.source.issued_date || "").localeCompare(left.source.issued_date || "") ||
          relationPriority[right.kind] - relationPriority[left.kind] ||
          right.source.score - left.source.score,
      )[0] ?? null
  );
}

export function relationCandidate(relation: LegalUpdateRelation): SearchCandidate {
  return {
    id: relation.source.id,
    number: relation.documentNumber,
    title: relation.source.title,
    type: relation.source.document_type || "Văn bản pháp luật",
    issuer: relation.source.issuer || "Chưa xác định cơ quan ban hành",
    issued_date: relation.source.issued_date || null,
    source_url: relation.source.url,
    source_label: relation.source.source_label,
  };
}

export function legalUpdateDescription(kind: LegalUpdateRelationKind) {
  if (kind === "replacement") return "thay thế";
  if (kind === "amendment") return "sửa đổi, bổ sung";
  return "bãi bỏ hoặc làm hết hiệu lực";
}
