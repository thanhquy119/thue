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

function prepareDurableResponse(response: ReturnType<typeof responseFromDurableRecord>) {
  if (!response?.document) return response;
  return { ...response, document: prepareDocumentForPresentation(response.document) };
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
  return prepareDurableResponse(responseFromDurableRecord(query, number, state, revision));
}
