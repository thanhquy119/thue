import type { TaxSearchResponse } from "./types.ts";

// Metadata-only results can change while ingestion runs. Re-fetch them so a
// processing/review response never hides a later published revision.
export function canCacheSearchResult(response: TaxSearchResponse) {
  return Boolean(response.document?.official_text?.trim());
}
