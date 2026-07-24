export type SearchDiscoverySafety = {
  warnings: string[];
  confidenceCap: number | null;
  hasConflict: boolean;
};

const CONFLICT_WARNING = /(?:Search Grounding|metadata).*(?:mâu thuẫn|xác minh toàn văn)|(?:mâu thuẫn).*(?:Search Grounding|metadata)/iu;

export function searchDiscoverySafety(
  warnings: string[] | undefined,
  conflicts: string[] | undefined,
  fullTextVerified: boolean,
): SearchDiscoverySafety {
  const hasConflict = Boolean(conflicts?.length);
  const retained = (warnings ?? []).filter((warning) => !hasConflict || !CONFLICT_WARNING.test(warning));

  if (hasConflict) {
    retained.push(
      fullTextVerified
        ? "Search Grounding có metadata mâu thuẫn với nguồn trực tiếp; hệ thống đã bỏ metadata đó và chỉ kết luận từ toàn văn tải được ở URL cơ quan nhà nước."
        : "Nguồn trực tiếp và Search Grounding có metadata mâu thuẫn; chưa mở được toàn văn để phân xử nên hệ thống không đưa ra kết luận pháp lý.",
    );
  }

  return {
    warnings: Array.from(new Set(retained)).slice(0, 5),
    confidenceCap: hasConflict && !fullTextVerified ? 0.38 : null,
    hasConflict,
  };
}

export function applySearchDiscoveryConfidence(
  confidence: number,
  safety: SearchDiscoverySafety,
) {
  return safety.confidenceCap === null
    ? confidence
    : Math.min(confidence, safety.confidenceCap);
}
