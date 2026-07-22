export type OcrSpeechMode = "content" | "verify";

const CHECKBOX_PATTERN = /(?:□|☐|☑|✓|✔)/gu;

export function cleanOcrSpeechText(value: string) {
  return value
    .replace(/^\s*\[\/?TABLE\]\s*$/gimu, " ")
    .replace(/\[không có nội dung chữ\]/giu, " ")
    .replace(/\[không đọc rõ\]/giu, "không đọc rõ")
    .replace(/☑|✓|✔/gu, " ô đã đánh dấu ")
    .replace(/□|☐/gu, " ô chưa đánh dấu ")
    .replace(/\|/gu, ", ")
    .replace(/[_─━—–=-]{5,}/gu, " ")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .replace(/([,.;:!?])(?=\S)/gu, "$1 ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function splitOcrSpeechChunks(value: string, maxLength = 280) {
  const text = cleanOcrSpeechText(value);
  if (!text) return [];
  const sentences = text.split(/(?<=[.!?;:])\s+/u).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const sentence of sentences) {
    if (sentence.length <= maxLength) {
      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length <= maxLength) current = candidate;
      else {
        pushCurrent();
        current = sentence;
      }
      continue;
    }

    pushCurrent();
    const words = sentence.split(/\s+/u);
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxLength) current = candidate;
      else {
        pushCurrent();
        current = word;
      }
    }
  }

  pushCurrent();
  return chunks;
}

function normalizedHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/giu, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function checkboxState(value: string) {
  if (/(?:☑|✓|✔)/u.test(value)) return "đã đánh dấu";
  if (/(?:□|☐)/u.test(value)) return "chưa đánh dấu";
  return "";
}

function readableCell(value: string) {
  const state = checkboxState(value);
  if (state && value.replace(CHECKBOX_PATTERN, "").trim() === "") return state;
  return cleanOcrSpeechText(value);
}

export function formatOcrTableRow(headers: string[], cells: string[], mode: OcrSpeechMode) {
  const width = Math.max(headers.length, cells.length);
  const paddedHeaders = Array.from({ length: width }, (_, index) => headers[index]?.trim() || `Cột ${index + 1}`);
  const paddedCells = Array.from({ length: width }, (_, index) => cells[index]?.trim() || "");

  if (mode === "verify") {
    return paddedCells
      .map((cell, index) => `${paddedHeaders[index]}: ${cell ? readableCell(cell) : "để trống"}`)
      .join(". ") + ".";
  }

  const indexColumn = paddedHeaders.findIndex((header) => /^(?:stt|số thứ tự)$/iu.test(header));
  const contentColumn = paddedHeaders.findIndex((header) => /nội dung|tiêu chí|họ và tên|tên mẫu/iu.test(header));
  const indexValue = indexColumn >= 0 ? cleanOcrSpeechText(paddedCells[indexColumn] ?? "") : "";
  const contentValue = contentColumn >= 0
    ? cleanOcrSpeechText(paddedCells[contentColumn] ?? "")
    : cleanOcrSpeechText(paddedCells.find((cell, index) => index !== indexColumn && !checkboxState(cell)) ?? "");
  const checkedLabels = paddedCells
    .map((cell, index) => checkboxState(cell) === "đã đánh dấu" ? paddedHeaders[index] : "")
    .filter(Boolean);
  const extras = paddedCells
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell, index }) => cell && index !== indexColumn && index !== contentColumn && !checkboxState(cell))
    .map(({ cell }) => cleanOcrSpeechText(cell))
    .filter(Boolean);

  const parts: string[] = [];
  if (indexValue) parts.push(`Mục ${indexValue}`);
  if (contentValue) parts.push(contentValue);
  if (checkedLabels.length) parts.push(`Đã chọn ${checkedLabels.join(", ")}`);
  if (extras.length) parts.push(extras.join(". "));
  return parts.join(". ") + (parts.length ? "." : "");
}
