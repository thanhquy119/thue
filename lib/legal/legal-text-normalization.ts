const STRUCTURAL_MARKDOWN_HEADING = /^(?:\s*#{1,6}\s*)?(?:\*\*|__)\s*((?:Điều|Chương|Mục|Phần)\s+[^\n]{1,240}?)(?:\*\*|__)(?=\s|$)/gimu;
const STRUCTURAL_WORD = "(?:Điều|Chương|Mục|Phần)";

function cleanLine(value: string) {
  return value
    .replace(/^\s*#{1,6}\s*/u, "")
    .replace(/(?:\*\*|__)([^*_\n]+)(?:\*\*|__)/gu, "$1")
    .replace(/^\s*(?:\*\*|__)\s*/u, "")
    .replace(/\s*(?:\*\*|__)\s*$/u, "")
    .replace(/[ ]{2,}/gu, " ")
    .trim();
}

/**
 * Chuẩn hóa lớp chữ pháp luật từ DOC/PDF/OCR để các tầng tìm kiếm,
 * phân cấp Điều và trình bày dùng cùng một đầu vào ổn định.
 */
export function normalizeLegalDocumentText(value: string) {
  let text = value
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t\u00a0\u2007\u202f]+/gu, " ");

  // OCR/LLM đôi khi trả Markdown: **Điều 3. Giải thích từ ngữ** Trong...
  // Chuyển dấu đóng đậm thành ranh giới dòng để phần sau không bị nhận nhầm là tiêu đề Điều.
  text = text.replace(STRUCTURAL_MARKDOWN_HEADING, (_match, heading: string) => `${heading.trim()}\n`);

  // Ghép trường hợp OCR tách riêng từ khóa cấu trúc và số thứ tự trên hai dòng.
  text = text.replace(
    new RegExp(`(^|\\n)\\s*(${STRUCTURAL_WORD})\\s*\\n\\s*([0-9IVXLC]+[a-zA-Z]?\\s*[.:]?)`, "gimu"),
    "$1$2 $3",
  );

  text = text
    .split("\n")
    .map(cleanLine)
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  return text;
}
