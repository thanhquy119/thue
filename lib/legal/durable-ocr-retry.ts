import type { DurableOcrPage } from "./durable-ingestion-types.ts";

export const MINIMUM_DURABLE_OCR_PAGE_SCORE = 0.62;

export function durableOcrPageNeedsRetry(page: DurableOcrPage) {
  return page.text.trim().length < 40 ||
    !Number.isFinite(page.score) || page.score < MINIMUM_DURABLE_OCR_PAGE_SCORE ||
    (page.similarity > 0 && page.similarity < 0.72);
}

export function pendingDurableOcrPages(requested: number[], completed: DurableOcrPage[]) {
  const byPage = new Map(completed.map((page) => [page.page, page]));
  return requested.filter((number) => {
    const page = byPage.get(number);
    return !page || durableOcrPageNeedsRetry(page);
  });
}

// A failed or poorer retry must not overwrite a better checkpoint.
export function mergeDurableOcrPages(original: DurableOcrPage[], retried: DurableOcrPage[]) {
  const byPage = new Map(original.map((page) => [page.page, page]));
  for (const page of retried) {
    const previous = byPage.get(page.page);
    const rank = (value: DurableOcrPage) =>
      (durableOcrPageNeedsRetry(value) ? 0 : 2) +
      (value.text.trim().length >= 40 && Number.isFinite(value.score) ? value.score : -1);
    if (!previous || rank(page) > rank(previous)) byPage.set(page.page, page);
  }
  return [...byPage.values()].sort((left, right) => left.page - right.page);
}
