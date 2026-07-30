function normalizedLines(value: string) {
  return value
    .replace(/```(?:text)?/giu, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t\u00a0]+/gu, " ")
    .replace(/[ ]{2,}/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()
    .split("\n");
}

function pageMarker(line: string, page: number) {
  const value = line.trim();
  if (!value) return false;

  if (/^(?:trang|page)\s*\d{1,4}(?:\s*(?:\/|trên|of)\s*\d{1,4})?$/iu.test(value)) return true;
  if (/^\d{1,4}\s*(?:\/|trên|of)\s*\d{1,4}$/iu.test(value)) return true;
  if (/^[-–—•·]\s*\d{1,4}\s*[-–—•·]$/u.test(value)) return true;
  if (/^[[(]\s*\d{1,4}\s*[\])]$/u.test(value)) return true;

  const bare = value.match(/^0*(\d{1,4})$/u);
  if (!bare) return false;
  const number = Number(bare[1]);
  return number === page;
}

/**
 * Loại số trang mà OCR thường chép ở mép trên hoặc mép dưới ảnh.
 * Chỉ xét các dòng biên để không làm mất số điều, khoản và dữ liệu ở giữa trang.
 */
export function stripOcrPageMarkers(value: string, page: number) {
  const lines = normalizedLines(value);
  if (!lines.length) return "";

  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1)?.trim()) lines.pop();

  if (lines.length && pageMarker(lines[0], page)) lines.shift();
  while (lines.length && !lines[0].trim()) lines.shift();

  if (lines.length && pageMarker(lines.at(-1) ?? "", page)) lines.pop();
  while (lines.length && !lines.at(-1)?.trim()) lines.pop();

  return lines.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}
