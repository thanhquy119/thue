import type { DurableIngestionState } from "./durable-ingestion-types.ts";

export type CronIngestionDecision = {
  shouldStart: boolean;
  reason: "new" | "forced" | "ready" | "processing" | "retry_wait" | "retry_due";
  ageHours: number | null;
};

export type CronRunLimit = {
  requested: number;
  effective: number;
  hardCap: number;
  clamped: boolean;
};

const DEFAULT_CRON_RUNS = 1;
const FREE_TIER_HARD_CAP = 2;

export function ingestionStateAgeHours(
  value: string,
  nowMs = Date.now(),
) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? (nowMs - time) / 3_600_000 : Number.POSITIVE_INFINITY;
}

export function cronRunLimit(value = process.env.LEGAL_CRON_MAX_RUNS): CronRunLimit {
  const parsed = Number(value);
  const requested = Number.isFinite(parsed) && parsed >= 1
    ? Math.floor(parsed)
    : DEFAULT_CRON_RUNS;
  const effective = Math.min(FREE_TIER_HARD_CAP, requested);
  return {
    requested,
    effective,
    hardCap: FREE_TIER_HARD_CAP,
    clamped: effective !== requested,
  };
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
