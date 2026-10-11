import { prepareDocumentForPresentation } from "./document-presentation.ts";
import {
  durableStoreConfigured,
  readDurableIngestionState,
  readDurableRevision,
} from "./durable-document-store.ts";
import {
  extractExactLegalNumber,
  responseFromDurableRecord,
} from "./durable-document-lookup-core.ts";
import { enrichDocumentWithOfficialMetadata } from "./official-document-metadata-fetch.ts";
import { shouldQueueExactIngestion } from "./exact-official-document-core.ts";

async function prepareDurableResponse(
  response: ReturnType<typeof responseFromDurableRecord>,
) {
  if (!response?.document) return response;
  const enriched = await enrichDocumentWithOfficialMetadata(response.document);
  return { ...response, document: prepareDocumentForPresentation(enriched) };
}

export async function durableDocumentResponse(query: string) {
  if (!durableStoreConfigured()) return null;
  const number = extractExactLegalNumber(query);
  if (!number) return null;

  const revision = await readDurableRevision(number).catch(() => null);
  if (revision?.validation.accepted) {
    return prepareDurableResponse(responseFromDurableRecord(query, number, null, revision));
  }

  const state = await readDurableIngestionState(number).catch(() => null);
  // Let exact-source discovery and its queue retry terminal records after the
  // existing cooldown. A stored needs_review result must not block them forever.
  if (state && shouldQueueExactIngestion(state)) return null;
  return prepareDurableResponse(responseFromDurableRecord(query, number, state, revision));
}
