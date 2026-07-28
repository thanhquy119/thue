import type { DurableLegalSource } from "./durable-ingestion-types.ts";
import { mergeOfficialDocumentMetadata } from "./official-document-metadata.ts";
import type { DocumentDetail } from "./types.ts";

function statusFromDate(effectiveDate: string | null) {
  if (!effectiveDate) return "unknown" as const;
  return effectiveDate > new Date().toISOString().slice(0, 10) ? "upcoming" as const : "effective" as const;
}

function sourceCandidate(document: DocumentDetail, source: DurableLegalSource): DocumentDetail {
  const effectiveDate = source.effectiveDate ?? document.effective_date;
  return {
    ...document,
    title: source.title || document.title,
    type: source.type || document.type,
    issuer: source.issuer || document.issuer,
    issued_date: source.issuedDate ?? document.issued_date,
    effective_date: effectiveDate,
    status: statusFromDate(effectiveDate),
    source_url: source.officialPageUrl || source.sourceUrl || document.source_url,
    source_label: source.sourceLabel || document.source_label,
  };
}

export function officialSourceCandidates(
  document: DocumentDetail,
  sources: DurableLegalSource[],
) {
  return sources.map((source) => sourceCandidate(document, source));
}

export function mergeDocumentWithOfficialSources(
  document: DocumentDetail,
  sources: DurableLegalSource[],
) {
  return mergeOfficialDocumentMetadata(document, officialSourceCandidates(document, sources));
}
