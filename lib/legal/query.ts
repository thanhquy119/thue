import type { SearchHint } from "./types";

const DIACRITICS = /[\u0300-\u036f]/g;

export function normalizeLegalQuery(value: string) {
  return value
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .replace(/đ/gi, (character) => (character === "Đ" ? "D" : "d"))
    .toLocaleLowerCase("vi")
    .replace(/nghi\s+(?:dinh|didnh|dihn|dinhh)/g, "nghi dinh")
    .replace(/thong\s+tu/g, "thong tu")
    .replace(/nghi\s+quyet/g, "nghi quyet")
    .replace(/\bgtgt\b/g, "gia tri gia tang")
    .replace(/\btncn\b/g, "thu nhap ca nhan")
    .replace(/\btndn\b/g, "thu nhap doanh nghiep")
    .replace(/\btmdt\b/g, "thuong mai dien tu")
    .replace(/\bnd\s*[- ]?\s*cp\b/g, "nd-cp")
    .replace(/\btt\s*[- ]?\s*btc\b/g, "tt-btc")
    .replace(/\bnq\s*[- ]?\s*(?:qh|cp)\b/g, (match) => match.replace(/\s+/g, "-"))
    .replace(/[^a-z0-9/_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SEARCH_STOP_WORDS = new Set([
  "thue",
  "van",
  "ban",
  "quy",
  "dinh",
  "muc",
  "dong",
  "doi",
  "voi",
  "nguoi",
  "nganh",
  "hang",
  "hien",
  "hanh",
  "nam",
  "the",
  "nao",
  "nhu",
  "can",
  "lam",
  "gi",
  "toi",
  "muon",
  "tim",
  "hieu",
  "chi",
  "tiet",
  "ve",
  "va",
  "hay",
  "cua",
  "co",
  "khong",
  "cho",
]);

export function retrievalSearchText(value: string) {
  return normalizeLegalQuery(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token))
    .join(" ");
}

export function significantSearchTokens(value: string) {
  return Array.from(
    new Set(
      retrievalSearchText(value)
        .split(" ")
        .filter(Boolean)
        .map((token) =>
          ["streamer", "streaming", "youtuber", "tiktoker"].includes(token) ? "contentcreator" : token,
        ),
    ),
  );
}

function intentRelevance(normalizedQuery: string, normalizedCandidate: string) {
  let score = 0;
  const householdQuestion = /\b(?:ho kinh doanh|ca nhan kinh doanh)\b/.test(normalizedQuery);
  const householdDocument = /\b(?:ho kinh doanh|ca nhan kinh doanh)\b/.test(normalizedCandidate);
  if (householdQuestion) score += householdDocument ? 0.9 : -0.25;

  const asksThresholdOrAmount = /\b(?:doanh thu|muc thue|thue suat|bao nhieu|co phai nop|phai nop thue|nop thue khong|mien thue|khong phai nop)\b/.test(
    normalizedQuery,
  );
  const policyDocument = /\b(?:chinh sach thue|doi tuong chiu thue|khong chiu thue|thu nhap chiu thue|can cu tinh thue)\b/.test(
    normalizedCandidate,
  );
  const procedureDocument = /\b(?:ho so thu tuc|thu tuc quan ly thue|khai thue|mau bieu|dang ky thue)\b/.test(
    normalizedCandidate,
  );
  if (asksThresholdOrAmount) {
    if (policyDocument) score += 1.2;
    if (procedureDocument) score -= 0.45;
  }

  const asksProcedure = /\b(?:ho so|thu tuc|khai thue|mau nao|dung mau|dang ky|han nop|thoi han|quyet toan)\b/.test(
    normalizedQuery,
  );
  if (asksProcedure && procedureDocument) score += 1.15;

  const asksInvoice = /\b(?:hoa don|may tinh tien)\b/.test(normalizedQuery);
  if (asksInvoice && /\b(?:hoa don|may tinh tien)\b/.test(normalizedCandidate)) score += 1.05;

  return score;
}

export function lexicalRelevance(query: string, candidate: string) {
  const tokens = significantSearchTokens(query);
  if (!tokens.length) return 0;
  const candidateTokens = new Set(significantSearchTokens(candidate));
  const matched = tokens.filter((token) => candidateTokens.has(token));
  if (!matched.length) return 0;
  const coverage = matched.length / tokens.length;
  const normalizedCandidate = normalizeLegalQuery(candidate);
  const normalizedQuery = normalizeLegalQuery(query);
  const phraseBoost = normalizedQuery.length > 3 && normalizedCandidate.includes(normalizedQuery) ? 0.25 : 0;
  return Math.max(
    0,
    Math.min(
      3.5,
      coverage + phraseBoost + Math.min(0.12, matched.length * 0.02) + intentRelevance(normalizedQuery, normalizedCandidate),
    ),
  );
}

const TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:nghi dinh|nd-cp|nd(?:\b|(?=\d)))/, "Nghị định"],
  [/\b(?:thong tu|tt-btc|tt(?:\b|(?=\d)))/, "Thông tư"],
  [/\b(?:nghi quyet|nq-qh|nq-cp|nq(?:\b|(?=\d)))/, "Nghị quyết"],
  [/\b(?:quyet dinh|qd-ttg|qd(?:\b|(?=\d)))/, "Quyết định"],
  [/\b(?:luat)\b/, "Luật"],
];

const QUESTION_PATTERNS =
  /\?|\b(?:bao nhieu|muc thue|thue suat|dong thue|nop thue|khai thue|khai ky nao|dung mau|the nao|duoc khong|co phai|phai khong|tai sao|can lam gi|van ban nao|bao gio|han nop|thoi han|doi tuong nao|thuoc dien|cach tinh|tinh nhu the nao|mien thue|giam thue|hoan thue|khau tru|quyet toan|hoa don|ho kinh doanh|doanh thu|chi phi duoc tru|thu nhap chiu thue)\b/;

export function extractSearchHint(query: string): SearchHint {
  const normalized = normalizeLegalQuery(query);
  const type = TYPE_PATTERNS.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
  const slashIdentifier = normalized.match(/\b(\d{1,4})\s*[/-]\s*(20\d{2})\b/);
  const compactIdentifier = normalized.match(/\b(?:nd|tt|nq|qd)\s*(\d{1,4})\s*[/-]\s*(20\d{2})\b/);
  const spacedIdentifier = normalized.match(
    /\b(?:nghi dinh|thong tu|nghi quyet|quyet dinh|luat|nd|tt|nq|qd)\s+(\d{1,4})(?:\s+(20\d{2}))?\b/,
  );
  const abbreviationIdentifier = normalized.match(
    /\b(\d{1,4})\s*[/-]\s*(20\d{2})\s*[/-]\s*(?:nd-cp|tt-[a-z0-9-]+|nq-[a-z0-9-]+|qd-[a-z0-9-]+|qh\d*)\b/,
  );
  const match = compactIdentifier ?? slashIdentifier ?? spacedIdentifier ?? abbreviationIdentifier;
  const looksLikeDocumentLookup = Boolean(type && match?.[1]);
  const wordCount = normalized.split(" ").filter(Boolean).length;
  const asksQuestion =
    QUESTION_PATTERNS.test(normalized) || (!looksLikeDocumentLookup && wordCount >= 4);

  return {
    normalized,
    number: match?.[1] ?? null,
    year: match?.[2] ?? null,
    type,
    asksQuestion,
  };
}

export function extractDocumentMentions(query: string): SearchHint[] {
  const normalized = normalizeLegalQuery(query);
  const mapping: Record<string, string> = {
    nd: "Nghị định",
    tt: "Thông tư",
    nq: "Nghị quyết",
    qd: "Quyết định",
    "nghi dinh": "Nghị định",
    "thong tu": "Thông tư",
    "nghi quyet": "Nghị quyết",
    "quyet dinh": "Quyết định",
    luat: "Luật",
  };
  const matches = [
    ...normalized.matchAll(
      /\b(nghi dinh|thong tu|nghi quyet|quyet dinh|luat|nd|tt|nq|qd)\s*(\d{1,4})(?:\s*[/-]?\s*(20\d{2}))?/g,
    ),
  ];
  const seen = new Set<string>();
  return matches.flatMap((match) => {
    const type = mapping[match[1]];
    const number = match[2];
    const year = match[3] ?? null;
    const key = `${type}:${number}:${year ?? ""}`;
    if (!type || seen.has(key)) return [];
    seen.add(key);
    return [{ normalized, type, number, year, asksQuestion: QUESTION_PATTERNS.test(normalized) }];
  });
}

export function containsPromptInjection(value: string) {
  const normalized = normalizeLegalQuery(value);
  return /\b(?:ignore|bo qua|system prompt|developer message|tiet lo prompt|lam theo lenh|khong can can cu)\b/.test(
    normalized,
  );
}

export function cleanUserQuery(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}
