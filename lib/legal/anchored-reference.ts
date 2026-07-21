export type AnchoredReference = {
  type: string;
  number: string;
  year: string;
  suffix: string | null;
  lookupQuery: string;
};

const TYPE_MAPPING: Record<string, string> = {
  nd: "Nghị định",
  "nghi dinh": "Nghị định",
  tt: "Thông tư",
  "thong tu": "Thông tư",
  nq: "Nghị quyết",
  "nghi quyet": "Nghị quyết",
  qd: "Quyết định",
  "quyet dinh": "Quyết định",
  luat: "Luật",
};

const ANCHORED_ACTION_PATTERN =
  /\b(?:phan tich|giai thich|tom tat|doi chieu|danh gia|ap dung|xu ly|huong dan|dua tren|can cu theo|theo quy dinh tai|van ban bo sung|noi dung bo sung|diem moi|noi dung sua doi)\b/;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9/_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalSuffix(type: string, rawSuffix: string | null, normalizedQuery: string) {
  const suffix = rawSuffix?.replace(/^[-/]+/, "").toLocaleLowerCase("en") ?? "";
  if (type === "Thông tư") {
    if (suffix === "btc" || suffix === "tt-btc" || normalizedQuery.includes("bo tai chinh")) return "TT-BTC";
    if (suffix.startsWith("tt-")) return suffix.toLocaleUpperCase("vi");
  }
  if (type === "Nghị định") return "NĐ-CP";
  if (type === "Nghị quyết" && suffix) return suffix.toLocaleUpperCase("vi");
  if (type === "Quyết định" && suffix) return suffix.toLocaleUpperCase("vi");
  if (type === "Luật" && /^qh\d*$/i.test(suffix)) return suffix.toLocaleUpperCase("vi");
  return suffix ? suffix.toLocaleUpperCase("vi") : null;
}

export function extractAnchoredReferences(query: string): AnchoredReference[] {
  const normalized = normalize(query);
  const matches = [
    ...normalized.matchAll(
      /\b(nghi dinh|thong tu|nghi quyet|quyet dinh|luat|nd|tt|nq|qd)\s*(?:so\s*)?(\d{1,4})\s*[/-]\s*(20\d{2})(?:\s*[/-]\s*([a-z0-9-]+))?/g,
    ),
  ];
  const seen = new Set<string>();

  return matches.flatMap((match) => {
    const type = TYPE_MAPPING[match[1]];
    const number = match[2];
    const year = match[3];
    if (!type || !number || !year) return [];
    const suffix = canonicalSuffix(type, match[4] ?? null, normalized);
    const key = `${type}:${number}:${year}:${suffix ?? ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const identifier = `${number}/${year}${suffix ? `/${suffix}` : ""}`;
    return [{ type, number, year, suffix, lookupQuery: `${type} ${identifier}` }];
  });
}

export function isAnchoredLegalQuestion(query: string) {
  const normalized = normalize(query);
  if (!extractAnchoredReferences(query).length) return false;
  return (
    ANCHORED_ACTION_PATTERN.test(normalized) ||
    /\btheo\s+(?:thong tu|nghi dinh|nghi quyet|quyet dinh|luat|tt|nd|nq|qd)\b/.test(normalized)
  );
}
