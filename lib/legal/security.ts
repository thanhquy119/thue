import { createHash } from "node:crypto";

const buckets = new Map<string, { startedAt: number; count: number }>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 24;

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function requestFingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  const salt = process.env.RATE_LIMIT_SALT || "thue-anonymous-bucket-v1";
  return sha256(`${salt}:${ip}`);
}

export function consumeMemoryRateLimit(bucket: string) {
  const now = Date.now();
  const current = buckets.get(bucket);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    buckets.set(bucket, { startedAt: now, count: 1 });
    return { allowed: true, remaining: MAX_REQUESTS - 1, retryAfter: 0 };
  }
  current.count += 1;
  if (buckets.size > 2_000) {
    for (const [key, value] of buckets) {
      if (now - value.startedAt >= WINDOW_MS) buckets.delete(key);
    }
  }
  return {
    allowed: current.count <= MAX_REQUESTS,
    remaining: Math.max(0, MAX_REQUESTS - current.count),
    retryAfter: Math.max(1, Math.ceil((WINDOW_MS - (now - current.startedAt)) / 1_000)),
  };
}

