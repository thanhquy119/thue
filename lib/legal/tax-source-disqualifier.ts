function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9%/_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function disqualifyTaxSource(query: string, candidate: string) {
  const normalizedQuery = normalize(query);
  const normalizedCandidate = normalize(candidate);
  const asksAmendment =
    /\b(?:sua doi|bo sung|thay the|bai bo|het hieu luc|doi chieu|diem moi|van ban nao bai bo)\b/.test(
      normalizedQuery,
    );
  const repealOnly =
    /\b(?:bai bo toan bo|bai bo thong tu|bai bo quyet dinh|quy dinh viec bai bo|het hieu luc toan bo)\b/.test(
      normalizedCandidate,
    );
  if (repealOnly && !asksAmendment) return true;

  const asksEnterprise = /\b(?:doanh nghiep|cong ty|to chuc|hop tac xa)\b/.test(normalizedQuery);
  const householdOnly =
    /\b(?:ho kinh doanh|ca nhan kinh doanh)\b/.test(normalizedCandidate) &&
    !/\b(?:doanh nghiep|cong ty|to chuc|nguoi nop thue)\b/.test(normalizedCandidate);
  if (asksEnterprise && householdOnly) return true;

  return false;
}
