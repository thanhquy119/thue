import {
  durableStoreConfigured,
  readDurableIngestionState,
  readDurableRevision,
} from "./durable-document-store.ts";
import {
  extractExactLegalNumber,
  responseFromDurableRecord,
} from "./durable-document-lookup-core.ts";

export async function durableDocumentResponse(query: string) {
  if (!durableStoreConfigured()) return null;
  const number = extractExactLegalNumber(query);
  if (!number) return null;
  const [state, revision] = await Promise.all([
    readDurableIngestionState(number).catch(() => null),
    readDurableRevision(number).catch(() => null),
  ]);
  return responseFromDurableRecord(query, number, state, revision);
}
