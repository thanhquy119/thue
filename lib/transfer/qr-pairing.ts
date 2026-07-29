const MIN_KEY_LENGTH = 20;
const MAX_KEY_LENGTH = 80;

export function normalizeQrPairingKey(value: string) {
  return value.replace(/[^a-z0-9]/giu, "").toLocaleUpperCase("en");
}

function acceptableKey(value: string) {
  const normalized = normalizeQrPairingKey(value);
  return normalized.length >= MIN_KEY_LENGTH && normalized.length <= MAX_KEY_LENGTH
    ? normalized
    : null;
}

export function pairingKeyFromQr(value: string, expectedOrigin: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//iu.test(trimmed) && !trimmed.includes("#pair=")) return acceptableKey(trimmed);
  try {
    const url = new URL(trimmed, expectedOrigin);
    if (url.origin !== expectedOrigin || !/^\/transfer\/?$/u.test(url.pathname)) return null;
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
    return acceptableKey(fragment.get("pair") ?? "");
  } catch {
    return null;
  }
}
