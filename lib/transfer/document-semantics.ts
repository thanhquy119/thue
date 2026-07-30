export type TransferDocumentRole =
  | "normal"
  | "appendix-title"
  | "appendix-note"
  | "section-title"
  | "recipients"
  | "signature-role"
  | "signer-name";

const APPENDIX_TITLE = /^phụ\s+lục(?:\s+(?:số\s+)?[ivxlcdm\d]+)?\b/iu;
const APPENDIX_NOTE = /^\(?\s*(?:kèm\s+theo|ban\s+hành\s+kèm\s+theo)\b/iu;
const RECIPIENTS = /^(?:nơi\s+nhận|kính\s+gửi)\s*:/iu;
const SIGNATURE_ROLE = /^(?:(?:kt|tl|tuq|q)\.\s*)?(?:bộ\s+trưởng|thứ\s+trưởng|thủ\s+trưởng|chủ\s+tịch|phó\s+chủ\s+tịch|tổng\s+cục\s+trưởng|phó\s+tổng\s+cục\s+trưởng|cục\s+trưởng|phó\s+cục\s+trưởng|giám\s+đốc|phó\s+giám\s+đốc|chánh\s+văn\s+phòng|phó\s+chánh\s+văn\s+phòng|thừa\s+lệnh|thừa\s+ủy\s+quyền)\b/iu;
const SIGNATURE_PREFIX = /^(?:đã\s+ký|ký\s+thay|ký\s+thừa\s+lệnh)\b/iu;

export function normalizeDocumentBlock(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

export function likelySignerName(value: string) {
  const text = normalizeDocumentBlock(value);
  if (!text || text.length > 70 || /[:;,.!?()]/u.test(text)) return false;
  const words = text.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 7) return false;
  return words.every((word) => /^[\p{Lu}Đ][\p{L}Đđ'’-]*$/u.test(word));
}

export function allCapsDocumentHeading(value: string) {
  const text = normalizeDocumentBlock(value);
  if (text.length < 8 || text.length > 220 || /[.!?;:]$/u.test(text)) return false;
  const letters = [...text].filter((character) => /\p{L}/u.test(character));
  if (letters.length < 5) return false;
  const uppercase = letters.filter((character) => character === character.toLocaleUpperCase("vi")).length;
  return uppercase / letters.length >= 0.86;
}

export function classifyTransferDocumentBlocks(values: string[]): TransferDocumentRole[] {
  const roles: TransferDocumentRole[] = [];
  let appendixContext = 0;
  let waitingForSigner = false;

  for (const raw of values) {
    const text = normalizeDocumentBlock(raw);
    if (!text) {
      roles.push("normal");
      continue;
    }

    if (APPENDIX_TITLE.test(text)) {
      roles.push("appendix-title");
      appendixContext = 2;
      waitingForSigner = false;
      continue;
    }

    if (appendixContext > 0 && (APPENDIX_NOTE.test(text) || allCapsDocumentHeading(text))) {
      roles.push("appendix-note");
      appendixContext -= 1;
      continue;
    }
    appendixContext = Math.max(0, appendixContext - 1);

    if (RECIPIENTS.test(text)) {
      roles.push("recipients");
      waitingForSigner = false;
      continue;
    }

    if (SIGNATURE_ROLE.test(text) || SIGNATURE_PREFIX.test(text)) {
      roles.push("signature-role");
      waitingForSigner = true;
      continue;
    }

    if (waitingForSigner && likelySignerName(text)) {
      roles.push("signer-name");
      waitingForSigner = false;
      continue;
    }

    if (allCapsDocumentHeading(text) && !/^CỘNG\s+HÒA|^ĐỘC\s+LẬP|^SỐ\s*:/iu.test(text)) {
      roles.push("section-title");
      continue;
    }

    roles.push("normal");
  }

  return roles;
}
