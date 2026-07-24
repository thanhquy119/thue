import type { DurableIngestionState } from "./durable-ingestion-types.ts";

export type CronIngestionDecision = {
  shouldStart: boolean;
  reason: "new" | "forced" | "ready" | "processing" | "retry_wait" | "retry_due";
  ageHours: number | null;
};

export function ingestionStateAgeHours(
  value: string,
  nowMs = Date.now(),
) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? (nowMs - time) / 3_600_000 : Number.POSITIVE_INFINITY;
}

export function cronIngestionDecision(
  state: DurableIngestionState | null,
  force = false,
  nowMs = Date.now(),
): CronIngestionDecision {
  if (force) return { shouldStart: true, reason: "forced", ageHours: state ? ingestionStateAgeHours(state.updatedAt, nowMs) : null };
  if (!state) return { shouldStart: true, reason: "new", ageHours: null };
  if (state.status === "ready") return { shouldStart: false, reason: "ready", ageHours: ingestionStateAgeHours(state.updatedAt, nowMs) };
  if (state.status === "processing") return { shouldStart: false, reason: "processing", ageHours: ingestionStateAgeHours(state.updatedAt, nowMs) };

  const ageHours = ingestionStateAgeHours(state.updatedAt, nowMs);
  return ageHours >= 12
    ? { shouldStart: true, reason: "retry_due", ageHours }
    : { shouldStart: false, reason: "retry_wait", ageHours };
}
