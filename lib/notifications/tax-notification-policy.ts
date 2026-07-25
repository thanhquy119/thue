import {
  classifyTaxDocumentForNotification,
  type PublishedDocumentNotification,
  type TaxNotificationClassification,
} from "./push-core.ts";

const HARD_NON_TAX_TITLE_EXCLUSIONS = [
  "phi va le phi",
  "muc thu phi",
  "thu phi",
  "quan ly phi",
  "hai quan",
  "xuat xu hang hoa",
  "kiem tra chuyen nganh",
  "dang ky kinh doanh",
  "dang ky doanh nghiep",
  "tai chinh doanh nghiep",
] as const;

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

export function classifyStrictTaxDocumentForNotification(
  input: Pick<PublishedDocumentNotification, "title" | "officialText" | "documentType" | "issuer">,
): TaxNotificationClassification {
  const title = normalizedVietnamese(input.title);
  const exclusions = HARD_NON_TAX_TITLE_EXCLUSIONS.filter((signal) => title.includes(signal));
  const explicitTaxTitle = /(?:^|\s)thue(?:\s|$)/u.test(title) || title.includes("hoa don dien tu") || title.includes("le phi mon bai");
  if (exclusions.length && !explicitTaxTitle) {
    return { eligible: false, reason: "excluded_topic", signals: exclusions };
  }
  return classifyTaxDocumentForNotification(input);
}
