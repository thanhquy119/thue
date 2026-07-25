import { createHash } from "node:crypto";

export type BrowserPushSubscription = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export type StoredPushSubscription = {
  id: string;
  subscription: BrowserPushSubscription;
  topics: ["new_documents"];
  createdAt: string;
  updatedAt: string;
};

export type PublishedDocumentNotification = {
  revisionId: string;
  number: string;
  title: string;
  issuedDate: string | null;
  publishedAt: string;
  accepted: boolean;
  documentType?: string | null;
  issuer?: string | null;
  officialText?: string | null;
};

export type PushNotificationPayload = {
  title: string;
  body: string;
  tag: string;
  url: string;
  number: string;
  revisionId: string;
  icon: string;
  badge: string;
};

export type TaxNotificationClassification = {
  eligible: boolean;
  reason: "tax_title" | "tax_content" | "excluded_topic" | "insufficient_tax_evidence";
  signals: string[];
};

export type ExplicitLegalRelation = {
  kind: "replaces" | "amends" | "repeals";
  targets: string[];
};

const BASE64_URL = /^[A-Za-z0-9_-]+$/u;
const PUSH_ENDPOINT_HOSTS = [
  "fcm.googleapis.com",
  ".push.services.mozilla.com",
  "web.push.apple.com",
  ".notify.windows.com",
] as const;

const TAX_TITLE_SIGNALS = [
  "quan ly thue",
  "dang ky thue",
  "ma so thue",
  "nguoi nop thue",
  "khai thue",
  "ke khai thue",
  "nop thue",
  "hoan thue",
  "khau tru thue",
  "quyet toan thue",
  "no thue",
  "cuong che thue",
  "hoa don dien tu",
  "le phi mon bai",
  "thue gia tri gia tang",
  "thue thu nhap doanh nghiep",
  "thue thu nhap ca nhan",
  "thue tieu thu dac biet",
  "thue bao ve moi truong",
  "thue tai nguyen",
  "thue su dung dat",
  "thue xuat khau",
  "thue nhap khau",
  "bieu thue",
  "thue nha thau",
  "thue toi thieu toan cau",
] as const;

const TAX_CONTENT_SIGNALS = [
  ...TAX_TITLE_SIGNALS,
  "co quan thue",
  "nghia vu thue",
  "tien thue",
  "mien thue",
  "giam thue",
  "gia tinh thue",
  "thu nhap chiu thue",
  "doi tuong chiu thue",
  "chung tu dien tu",
] as const;

const NON_TAX_TITLE_EXCLUSIONS = [
  "phu hieu",
  "cap hieu",
  "trang phuc",
  "bien hieu",
  "chuc nang nhiem vu",
  "chuc nang quyen han",
  "co cau to chuc",
  "vi tri viec lam",
  "bien che",
  "tuyen dung",
  "bo nhiem",
  "luan chuyen",
  "dao tao boi duong",
  "thi dua khen thuong",
  "ky luat cong chuc",
  "tien luong",
  "cong chuc thue",
  "quan ly tai san",
  "tai san cong",
  "mua sam cong",
  "dau thau",
  "ke toan",
  "kiem toan",
  "ngan sach nha nuoc",
  "chung khoan",
  "bao hiem",
  "dang ky doanh nghiep",
] as const;

const LEGAL_NUMBER = /\b\d{1,4}\s*\/\s*20\d{2}\s*\/\s*[A-ZĐa-z0-9-]+\b/gu;

function allowedPushEndpointHost(hostname: string) {
  const host = hostname.toLocaleLowerCase("en");
  return PUSH_ENDPOINT_HOSTS.some((allowed) =>
    allowed.startsWith(".") ? host.endsWith(allowed) : host === allowed,
  );
}

function cleanKey(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (clean.length < minimum || clean.length > maximum || !BASE64_URL.test(clean)) return null;
  return clean;
}

function normalizedVietnamese(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchingSignals(value: string, signals: readonly string[]) {
  return signals.filter((signal) => value.includes(signal));
}

function hasStandaloneTaxWord(value: string) {
  return /(?:^|\s)thue(?:\s|$)/u.test(value);
}

export function classifyTaxDocumentForNotification(
  input: Pick<PublishedDocumentNotification, "title" | "officialText" | "documentType" | "issuer">,
): TaxNotificationClassification {
  const title = normalizedVietnamese(input.title);
  const documentType = normalizedVietnamese(input.documentType);
  const officialText = normalizedVietnamese(input.officialText);
  const excluded = matchingSignals(title, NON_TAX_TITLE_EXCLUSIONS);
  if (excluded.length) {
    return { eligible: false, reason: "excluded_topic", signals: excluded };
  }

  const titleSignals = matchingSignals(title, TAX_TITLE_SIGNALS);
  if (titleSignals.length || hasStandaloneTaxWord(title)) {
    return {
      eligible: true,
      reason: "tax_title",
      signals: titleSignals.length ? titleSignals : ["thue"],
    };
  }

  const contentSignals = matchingSignals(officialText, TAX_CONTENT_SIGNALS);
  const legalDocument = /(?:luat|nghi dinh|thong tu|nghi quyet|quyet dinh|van ban)/u.test(
    `${documentType} ${title}`,
  );
  if (legalDocument && new Set(contentSignals).size >= 2) {
    return { eligible: true, reason: "tax_content", signals: [...new Set(contentSignals)].slice(0, 8) };
  }

  return { eligible: false, reason: "insufficient_tax_evidence", signals: contentSignals.slice(0, 8) };
}

function normalizedDocumentNumber(value: string) {
  return value
    .replace(/\s+/gu, "")
    .replace(/ND-CP/giu, "NĐ-CP")
    .replace(/QD-/giu, "QĐ-")
    .toLocaleUpperCase("vi");
}

function relationKind(block: string): ExplicitLegalRelation["kind"] | null {
  if (/\bthay the\b/u.test(block)) return "replaces";
  if (/\bbai bo\b/u.test(block)) return "repeals";
  if (/\b(?:sua doi|bo sung)\b/u.test(block)) return "amends";
  return null;
}

function directRelationClause(block: string, fromTitle: boolean) {
  const passiveHistory = /\b(?:da duoc|duoc)\s+(?:sua doi|bo sung|thay the)\b/u.test(block);
  if (passiveHistory && !fromTitle) return false;
  if (fromTitle) return /\b(?:thay the|sua doi|bo sung|bai bo)\b/u.test(block);
  if (/\b(?:luat|nghi dinh|thong tu|nghi quyet|quyet dinh|van ban) nay\b.{0,240}\b(?:thay the|sua doi|bo sung|bai bo)\b/u.test(block)) return true;
  return /\b(?:thay the|sua doi|bo sung|bai bo)\b.{0,220}\b(?:luat|nghi dinh|thong tu|nghi quyet|quyet dinh)(?: so)?\s+\d/u.test(block);
}

export function extractExplicitLegalRelations(
  input: Pick<PublishedDocumentNotification, "number" | "title" | "officialText">,
): ExplicitLegalRelation[] {
  const ownNumber = normalizedDocumentNumber(input.number);
  const textBlocks = (input.officialText ?? "")
    .split(/[\n;]+/u)
    .map((value) => value.trim())
    .filter((value) => value.length >= 12 && value.length <= 1_500);
  const candidates = [{ value: input.title, fromTitle: true }, ...textBlocks.map((value) => ({ value, fromTitle: false }))];
  const grouped = new Map<ExplicitLegalRelation["kind"], Set<string>>();

  for (const candidate of candidates) {
    const normalized = normalizedVietnamese(candidate.value);
    const kind = relationKind(normalized);
    if (!kind || !directRelationClause(normalized, candidate.fromTitle)) continue;
    const targets = candidate.value.match(LEGAL_NUMBER) ?? [];
    for (const target of targets) {
      const number = normalizedDocumentNumber(target);
      if (number === ownNumber) continue;
      const collection = grouped.get(kind) ?? new Set<string>();
      collection.add(number);
      grouped.set(kind, collection);
    }
  }

  return (["replaces", "amends", "repeals"] as const)
    .map((kind) => ({ kind, targets: [...(grouped.get(kind) ?? [])].slice(0, 4) }))
    .filter((relation) => relation.targets.length > 0);
}

export function normalizePushSubscription(value: unknown): BrowserPushSubscription | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    endpoint?: unknown;
    expirationTime?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown } | null;
  };
  if (typeof candidate.endpoint !== "string" || candidate.endpoint.length > 2_048) return null;

  let endpoint: URL;
  try {
    endpoint = new URL(candidate.endpoint.trim());
  } catch {
    return null;
  }
  if (endpoint.protocol !== "https:" || !allowedPushEndpointHost(endpoint.hostname)) return null;

  const p256dh = cleanKey(candidate.keys?.p256dh, 40, 256);
  const auth = cleanKey(candidate.keys?.auth, 12, 128);
  if (!p256dh || !auth) return null;

  const expirationTime = candidate.expirationTime == null
    ? null
    : typeof candidate.expirationTime === "number" && Number.isFinite(candidate.expirationTime)
      ? candidate.expirationTime
      : null;

  return {
    endpoint: endpoint.toString(),
    expirationTime,
    keys: { p256dh, auth },
  };
}

export function pushSubscriptionId(endpoint: string) {
  return createHash("sha256").update(endpoint).digest("hex");
}

export function requestOriginAllowed(requestOrigin: string | null, requestUrl: string, production: boolean) {
  if (!requestOrigin) return !production;
  try {
    return new URL(requestOrigin).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

export function shouldNotifyPublishedDocument(
  input: PublishedDocumentNotification,
  nowMs = Date.now(),
  maximumAgeDays = 60,
) {
  if (!input.accepted || !input.revisionId || !input.number || !input.title || !input.issuedDate) return false;
  if (!classifyTaxDocumentForNotification(input).eligible) return false;
  if (!/^20\d{2}-\d{2}-\d{2}$/u.test(input.issuedDate)) return false;
  const issuedAt = Date.parse(`${input.issuedDate}T00:00:00.000Z`);
  if (!Number.isFinite(issuedAt)) return false;
  const age = nowMs - issuedAt;
  return age >= -86_400_000 && age <= Math.max(1, maximumAgeDays) * 86_400_000;
}

function compact(value: string, maximum: number) {
  const clean = value.replace(/\s+/gu, " ").trim();
  if (clean.length <= maximum) return clean;
  return `${clean.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function relationLabel(relation: ExplicitLegalRelation) {
  if (relation.kind === "replaces") return "Thay thế";
  if (relation.kind === "repeals") return "Bãi bỏ";
  return "Sửa đổi";
}

export function publishedDocumentPayload(input: PublishedDocumentNotification): PushNotificationPayload {
  const relation = extractExplicitLegalRelations(input)[0] ?? null;
  const relationSuffix = relation
    ? `${relationLabel(relation)} ${relation.targets[0]}${relation.targets.length > 1 ? ` +${relation.targets.length - 1}` : ""}`
    : input.title;
  return {
    title: "Văn bản thuế mới",
    body: compact(`${input.number} · ${relationSuffix}`, 150),
    tag: `legal-${input.revisionId.slice(0, 24)}`,
    url: `/?document=${encodeURIComponent(input.number)}&source=notification`,
    number: input.number,
    revisionId: input.revisionId,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
  };
}

export function pushErrorStatus(error: unknown) {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function expiredPushSubscriptionError(error: unknown) {
  const status = pushErrorStatus(error);
  return status === 404 || status === 410;
}
