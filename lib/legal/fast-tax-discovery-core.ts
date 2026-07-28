import { normalizeDocumentNumber, type DurableLegalSource } from "./durable-ingestion-types.ts";

export type FastTaxDiscoveryCandidate = {
  number: string;
  title: string;
  type: string;
  issuer: string;
  issuedDate: string | null;
  effectiveDate: string | null;
  officialPageUrl: string;
  sourceUrl: string;
  sourceLabel: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type FastTaxDiscoveryIndex = {
  version: 1;
  bootstrappedAt: string;
  candidates: Record<string, FastTaxDiscoveryCandidate>;
  startsByDay: Record<string, string[]>;
};

export type FastTaxDiscoveryMerge = {
  index: FastTaxDiscoveryIndex;
  bootstrapped: boolean;
  newNumbers: string[];
};

const CANDIDATE_RETENTION_DAYS = 180;
const START_HISTORY_RETENTION_DAYS = 14;

function validIso(value: string) {
  return Number.isFinite(Date.parse(value));
}

function candidateKey(number: string) {
  return normalizeDocumentNumber(number);
}

function candidateFromSource(
  source: DurableLegalSource,
  firstSeenAt: string,
  lastSeenAt: string,
): FastTaxDiscoveryCandidate {
  return {
    number: source.number,
    title: source.title,
    type: source.type,
    issuer: source.issuer,
    issuedDate: source.issuedDate,
    effectiveDate: source.effectiveDate,
    officialPageUrl: source.officialPageUrl,
    sourceUrl: source.sourceUrl,
    sourceLabel: source.sourceLabel,
    firstSeenAt,
    lastSeenAt,
  };
}

function prunedStarts(startsByDay: Record<string, string[]>, nowMs: number) {
  const cutoff = nowMs - START_HISTORY_RETENTION_DAYS * 86_400_000;
  return Object.fromEntries(
    Object.entries(startsByDay).filter(([day]) => {
      const timestamp = Date.parse(`${day}T00:00:00.000Z`);
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    }),
  );
}

function prunedCandidates(
  candidates: Record<string, FastTaxDiscoveryCandidate>,
  nowMs: number,
) {
  const cutoff = nowMs - CANDIDATE_RETENTION_DAYS * 86_400_000;
  return Object.fromEntries(
    Object.entries(candidates).filter(([, candidate]) => {
      const timestamp = Date.parse(candidate.lastSeenAt);
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    }),
  );
}

export function mergeFastTaxDiscoveryIndex(
  current: FastTaxDiscoveryIndex | null,
  sources: DurableLegalSource[],
  nowIso = new Date().toISOString(),
): FastTaxDiscoveryMerge {
  const nowMs = Date.parse(nowIso);
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const normalizedNow = new Date(safeNow).toISOString();
  const bootstrapped = !current;
  const index: FastTaxDiscoveryIndex = current
    ? {
        version: 1,
        bootstrappedAt: validIso(current.bootstrappedAt)
          ? current.bootstrappedAt
          : normalizedNow,
        candidates: prunedCandidates(current.candidates ?? {}, safeNow),
        startsByDay: prunedStarts(current.startsByDay ?? {}, safeNow),
      }
    : {
        version: 1,
        bootstrappedAt: normalizedNow,
        candidates: {},
        startsByDay: {},
      };

  const newNumbers: string[] = [];
  for (const source of sources) {
    const key = candidateKey(source.number);
    if (!key) continue;
    const previous = index.candidates[key];
    if (!previous && !bootstrapped) newNumbers.push(source.number);
    index.candidates[key] = candidateFromSource(
      source,
      previous?.firstSeenAt ?? normalizedNow,
      normalizedNow,
    );
  }

  return {
    index,
    bootstrapped,
    newNumbers: Array.from(new Set(newNumbers)),
  };
}

export function recentFastTaxDiscoveryNumbers(
  index: FastTaxDiscoveryIndex,
  limit = 80,
) {
  return Object.values(index.candidates)
    .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))
    .slice(0, Math.max(1, limit))
    .map((candidate) => candidate.number);
}

export function claimFastTaxDiscoveryStarts(
  index: FastTaxDiscoveryIndex,
  requestedNumbers: string[],
  nowIso = new Date().toISOString(),
  maximumPerDay = 2,
) {
  const day = nowIso.slice(0, 10);
  const existing = new Set(index.startsByDay[day] ?? []);
  const available = Math.max(0, Math.max(1, maximumPerDay) - existing.size);
  const claimed: string[] = [];

  for (const number of requestedNumbers) {
    const key = candidateKey(number);
    if (!key || existing.has(key) || claimed.length >= available) continue;
    existing.add(key);
    claimed.push(number);
  }

  return {
    index: {
      ...index,
      startsByDay: {
        ...index.startsByDay,
        [day]: [...existing],
      },
    },
    claimed,
  };
}

export function sourceFromFastCandidate(
  candidate: FastTaxDiscoveryCandidate,
): DurableLegalSource {
  return {
    number: candidate.number,
    title: candidate.title,
    type: candidate.type,
    issuer: candidate.issuer,
    issuedDate: candidate.issuedDate,
    effectiveDate: candidate.effectiveDate,
    officialPageUrl: candidate.officialPageUrl,
    sourceUrl: candidate.sourceUrl,
    sourceLabel: candidate.sourceLabel,
  };
}
