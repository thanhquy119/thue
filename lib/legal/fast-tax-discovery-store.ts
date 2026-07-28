import {
  get,
  put,
  storageConfigured,
} from "../storage/r2-blob-compat.ts";
import {
  claimFastTaxDiscoveryStarts,
  mergeFastTaxDiscoveryIndex,
  recentFastTaxDiscoveryNumbers,
  type FastTaxDiscoveryIndex,
} from "./fast-tax-discovery-core.ts";
import type { DurableLegalSource } from "./durable-ingestion-types.ts";

const STATE_PATH = "legal-discovery/fast-tax-discovery-v1.json";

async function streamText(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return "";
  return new Response(stream).text();
}

export function fastTaxDiscoveryStoreConfigured() {
  return storageConfigured();
}

export async function readFastTaxDiscoveryIndex(): Promise<FastTaxDiscoveryIndex | null> {
  if (!fastTaxDiscoveryStoreConfigured()) return null;
  const result = await get(STATE_PATH, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  const text = await streamText(result.stream);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as FastTaxDiscoveryIndex;
    return parsed?.version === 1 && parsed.candidates && parsed.startsByDay
      ? parsed
      : null;
  } catch {
    return null;
  }
}

async function writeFastTaxDiscoveryIndex(index: FastTaxDiscoveryIndex) {
  if (!fastTaxDiscoveryStoreConfigured()) {
    throw new Error("R2 hoặc Private Blob chưa được cấu hình cho phát hiện văn bản nhanh.");
  }
  await put(STATE_PATH, JSON.stringify(index), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
    contentType: "application/json; charset=utf-8",
  });
}

export async function recordFastTaxDiscovery(
  sources: DurableLegalSource[],
  nowIso = new Date().toISOString(),
) {
  const current = await readFastTaxDiscoveryIndex();
  const merged = mergeFastTaxDiscoveryIndex(current, sources, nowIso);
  await writeFastTaxDiscoveryIndex(merged.index);
  return merged;
}

export async function claimFastTaxStarts(
  requestedNumbers: string[],
  nowIso = new Date().toISOString(),
  maximumPerDay = 2,
) {
  const current = await readFastTaxDiscoveryIndex();
  if (!current) return { claimed: [] as string[], index: null };
  const claim = claimFastTaxDiscoveryStarts(
    current,
    requestedNumbers,
    nowIso,
    maximumPerDay,
  );
  await writeFastTaxDiscoveryIndex(claim.index);
  return claim;
}

export async function recentFastTaxCandidateNumbers(limit = 80) {
  const current = await readFastTaxDiscoveryIndex();
  return current ? recentFastTaxDiscoveryNumbers(current, limit) : [];
}
