export type LegalBlockKind =
  | "paragraph"
  | "clause"
  | "point"
  | "heading"
  | "preamble-authority"
  | "preamble-national"
  | "preamble-motto"
  | "preamble-number"
  | "preamble-dateline"
  | "preamble-type"
  | "preamble-title";

export type LegalBlock = {
  text: string;
  kind: LegalBlockKind;
};

const NATIONAL_HEADING = "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM";
const NATIONAL_MOTTO = "Độc lập - Tự do - Hạnh phúc";
const BOILERPLATE = /\bVĂN\s+BẢN\s+QUY\s+PHẠM\s+PHÁP\s+LUẬT\b/giu;
const DOCUMENT_NUMBER = /(?:LUẬT\s+)?Số\s*:\s*(\d{1,4}(?:\s*\/\s*\d{4})?\s*\/\s*[A-ZĐ0-9-]+)/iu;
const DOCUMENT_TYPES = [
  "NGHỊ QUYẾT LIÊN TỊCH",
  "THÔNG TƯ LIÊN TỊCH",
  "NGHỊ ĐỊNH",
  "NGHỊ QUYẾT",
  "QUYẾT ĐỊNH",
  "THÔNG TƯ",
  "CHỈ THỊ",
  "PHÁP LỆNH",
  "LUẬT",
  "THÔNG BÁO",
  "CÔNG VĂN",
] as const;

function normalizeLines(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function cleanDecoration(value: string) {
  return value
    .replace(BOILERPLATE, " ")
    .replace(/[_━─—-]{3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDocumentNumber(value: string) {
  return value.replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
}

function findDocumentNumber(value: string) {
  const match = value.match(DOCUMENT_NUMBER);
  return match ? `Số: ${normalizeDocumentNumber(match[1])}` : null;
}

function findDateline(lines: string[], headerText: string) {
  const datePattern = /(?:^|\s)([^,;\n]{2,55}),\s*ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})/iu;
  const exactLine = lines.find((line) => /,\s*ngày\s+\d{1,2}\s+tháng\s+\d{1,2}\s+năm\s+\d{4}/iu.test(line));
  const match = (exactLine || headerText).match(datePattern);
  if (!match) return null;

  let location = cleanDecoration(match[1])
    .replace(/.*(?:Hạnh phúc|HẠNH PHÚC)\s*/u, "")
    .replace(/.*(?:Số\s*:\s*\S+)\s*/iu, "")
    .trim();
  const words = location.split(" ").filter(Boolean);
  if (words.length > 6) location = words.slice(-6).join(" ");
  if (!location || /^(?:ngày|tháng|năm)$/iu.test(location)) location = "";

  const [, , day, month, year] = match;
  return `${location ? `${location}, ` : ""}ngày ${Number(day)} tháng ${Number(month)} năm ${year}`;
}

function inferAuthorityFromNumber(number: string | null) {
  const upper = number?.toLocaleUpperCase("vi") || "";
  if (/\/NĐ-CP\b/u.test(upper) || /\/NQ-CP\b/u.test(upper)) return "CHÍNH PHỦ";
  if (/\/QĐ-TTG\b/u.test(upper)) return "THỦ TƯỚNG CHÍNH PHỦ";
  if (/\/TT-BTC\b/u.test(upper)) return "BỘ TÀI CHÍNH";
  if (/\/QH\d*\b/u.test(upper)) return "QUỐC HỘI";
  if (/\/UBTVQH\d*\b/u.test(upper)) return "ỦY BAN THƯỜNG VỤ QUỐC HỘI";
  return "CƠ QUAN BAN HÀNH";
}

function findAuthority(lines: string[], headerText: string, number: string | null) {
  const structuralIndex = lines.findIndex((line) =>
    /CỘNG\s+HÒA|Độc\s+lập|(?:LUẬT\s+)?Số\s*:|,\s*ngày\s+\d{1,2}\s+tháng/iu.test(line) ||
    DOCUMENT_TYPES.some((type) => typePattern(type).test(line)),
  );
  const candidateLines = lines
    .slice(0, structuralIndex >= 0 ? structuralIndex + 1 : Math.min(lines.length, 8))
    .map((line) => line.split(/CỘNG\s+HÒA/iu)[0])
    .map(cleanDecoration)
    .filter((line) => line && !/VĂN\s+BẢN\s+QUY\s+PHẠM\s+PHÁP\s+LUẬT/iu.test(line));
  const prefixBeforeNational = headerText.split(/CỘNG\s+HÒA/iu)[0].replace(BOILERPLATE, " ");
  const authorityArea = `${candidateLines.join("\n")}\n${prefixBeforeNational}`;
  const known = [
    /ỦY BAN THƯỜNG VỤ QUỐC HỘI/iu,
    /THỦ TƯỚNG CHÍNH PHỦ/iu,
    /BỘ TÀI CHÍNH/iu,
    /TỔNG CỤC THUẾ/iu,
    /CỤC THUẾ/iu,
    /CHÍNH PHỦ/iu,
    /QUỐC HỘI/iu,
  ];

  for (const pattern of known) {
    const match = authorityArea.match(pattern);
    if (match) return match[0].toLocaleUpperCase("vi");
  }

  const genericLine = candidateLines.find((line) => {
    if (line.length < 3 || line.length > 90) return false;
    if (/CỘNG HÒA|Độc lập|Số\s*:|,\s*ngày\s+|Căn cứ/iu.test(line)) return false;
    const letters = [...line].filter((character) => /\p{L}/u.test(character));
    if (!letters.length) return false;
    const uppercase = letters.filter((character) => character === character.toLocaleUpperCase("vi")).length;
    return uppercase / letters.length > 0.82;
  });

  return cleanDecoration(genericLine || inferAuthorityFromNumber(number));
}

function typePattern(type: string) {
  return new RegExp(`(?:^|\\s)(${type.replace(/\s+/g, "\\s+")})(?=\\s|$|[:.–—-])`, "iu");
}

function inferDocumentTypeFromNumber(number: string | null) {
  const upper = number?.toLocaleUpperCase("vi") || "";
  if (/\/NĐ-CP\b/u.test(upper)) return "NGHỊ ĐỊNH";
  if (/\/TT-/u.test(upper)) return "THÔNG TƯ";
  if (/\/NQ-/u.test(upper)) return "NGHỊ QUYẾT";
  if (/\/QĐ-/u.test(upper)) return "QUYẾT ĐỊNH";
  if (/\/QH\d*\b/u.test(upper)) return "LUẬT";
  return null;
}

function findDocumentType(headerText: string, number: string | null) {
  const cleanHeader = headerText.replace(BOILERPLATE, " ");
  const expectedType = inferDocumentTypeFromNumber(number);
  if (expectedType) {
    const expectedMatch = cleanHeader.match(typePattern(expectedType));
    if (expectedMatch?.index != null) {
      const leading = expectedMatch[0].length - expectedMatch[1].length;
      return {
        type: expectedType,
        index: expectedMatch.index + leading,
        length: expectedMatch[1].length,
        source: cleanHeader,
      };
    }
    return { type: expectedType, index: -1, length: 0, source: cleanHeader };
  }

  const matches = DOCUMENT_TYPES.flatMap((type) => {
    const match = cleanHeader.match(typePattern(type));
    if (match?.index == null) return [];
    const leading = match[0].length - match[1].length;
    return [{ type, index: match.index + leading, length: match[1].length }];
  }).sort((left, right) => left.index - right.index || right.length - left.length);
  if (matches.length) return { ...matches[0], source: cleanHeader };
  return { type: "VĂN BẢN", index: -1, length: 0, source: cleanHeader };
}

function removeStructuralHeader(value: string, authority: string, number: string | null, dateline: string | null) {
  let result = value.replace(BOILERPLATE, " ");
  const removable = [
    authority,
    NATIONAL_HEADING,
    NATIONAL_MOTTO,
    number,
    dateline,
  ].filter((item): item is string => Boolean(item));

  for (const item of removable) {
    const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    result = result.replace(new RegExp(escaped, "giu"), " ");
  }

  result = result.replace(DOCUMENT_NUMBER, " ");
  result = result.replace(/[^,;\n]{0,55},\s*ngày\s+\d{1,2}\s+tháng\s+\d{1,2}\s+năm\s+\d{4}/giu, " ");
  return cleanDecoration(result);
}

function splitPreambleBody(value: string): LegalBlock[] {
  const prepared = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/;\s*(?=(?:Căn\s+cứ|Theo\s+đề\s+nghị|Xét\s+đề\s+nghị|Theo\s+đề\s+xuất)(?=\s|$|[,:;.]))/giu, ";\n\n")
    .replace(/\s+(?=(?:Căn\s+cứ|Theo\s+đề\s+nghị|Xét\s+đề\s+nghị|Theo\s+đề\s+xuất)(?=\s|$|[,:;.]))/giu, "\n\n");
  return splitStandardLegalBlocks(prepared);
}

function splitPreambleBlocks(value: string): LegalBlock[] {
  const lines = normalizeLines(value);
  const normalized = lines.join("\n");
  const bodyMatch = normalized.match(/(?:^|\n)(?=(?:Căn\s+cứ|Theo\s+đề\s+nghị|Xét\s+đề\s+nghị|Theo\s+đề\s+xuất)(?=\s|$|[,:;.]))/iu);
  const bodyIndex = bodyMatch?.index ?? normalized.search(/Căn\s+cứ(?=\s|$|[,:;.])/iu);
  const headerText = bodyIndex >= 0 ? normalized.slice(0, bodyIndex) : normalized;
  const bodyText = bodyIndex >= 0 ? normalized.slice(bodyIndex).trim() : "";
  const headerLines = normalizeLines(headerText);

  const number = findDocumentNumber(headerText);
  const dateline = findDateline(headerLines, headerText);
  const authority = findAuthority(headerLines, headerText, number);
  const typeInfo = findDocumentType(headerText, number);
  const structuralFree = removeStructuralHeader(headerText, authority, number, dateline);
  let rawTitle = typeInfo.index >= 0
    ? typeInfo.source.slice(typeInfo.index + typeInfo.length)
    : structuralFree;
  rawTitle = rawTitle
    .replace(BOILERPLATE, " ")
    .replace(NATIONAL_HEADING, " ")
    .replace(NATIONAL_MOTTO, " ")
    .replace(DOCUMENT_NUMBER, " ")
    .replace(/[^,;\n]{0,55},\s*ngày\s+\d{1,2}\s+tháng\s+\d{1,2}\s+năm\s+\d{4}/giu, " ");
  const title = cleanDecoration(rawTitle);

  const blocks: LegalBlock[] = [
    { text: authority, kind: "preamble-authority" },
    { text: NATIONAL_HEADING, kind: "preamble-national" },
    { text: NATIONAL_MOTTO, kind: "preamble-motto" },
  ];
  if (number) blocks.push({ text: number, kind: "preamble-number" });
  if (dateline) blocks.push({ text: dateline, kind: "preamble-dateline" });
  blocks.push({ text: typeInfo.type, kind: "preamble-type" });
  if (title && title.toLocaleUpperCase("vi") !== typeInfo.type) blocks.push({ text: title, kind: "preamble-title" });
  blocks.push(...splitPreambleBody(bodyText));
  return blocks;
}

function looksLikePreamble(value: string) {
  const sample = value.slice(0, 12_000);
  const hasNationalHeading = /CỘNG\s+HÒA\s+XÃ\s+HỘI\s+CHỦ\s+NGHĨA\s+VIỆT\s+NAM/iu.test(sample);
  const hasNumber = /(?:LUẬT\s+)?Số\s*:\s*\d{1,4}(?:\s*\/\s*\d{4})?\s*\/\s*[A-ZĐ0-9-]+/iu.test(sample);
  const hasBasis = /Căn\s+cứ(?=\s|$|[,:;.])/iu.test(sample);
  const hasType = DOCUMENT_TYPES.some((type) => typePattern(type).test(sample));
  return hasNationalHeading || (hasNumber && hasBasis && hasType);
}

function blockKind(value: string): LegalBlockKind {
  if (/^(?:CHƯƠNG|Chương|MỤC|Mục|PHẦN|Phần)\s+/u.test(value)) return "heading";
  if (/^\d+[.)]\s+/u.test(value)) return "clause";
  if (/^[a-zđ][.)]\s+/iu.test(value)) return "point";
  return "paragraph";
}

function splitStandardLegalBlocks(value: string): LegalBlock[] {
  const lines = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim());

  const blocks: LegalBlock[] = [];
  let current = "";
  let currentKind: LegalBlockKind = "paragraph";

  const flush = () => {
    const text = current.trim();
    if (text) blocks.push({ text, kind: currentKind });
    current = "";
    currentKind = "paragraph";
  };

  for (const line of lines) {
    if (!line) {
      flush();
      continue;
    }

    const onlyMarker = /^(?:\d+[.)]|[a-zđ][.)]|[-–—])$/iu.test(line);
    const startsStructure = /^(?:CHƯƠNG|Chương|MỤC|Mục|PHẦN|Phần)\s+|^\d+[.)]\s+|^[a-zđ][.)]\s+/iu.test(line);

    if (onlyMarker) {
      flush();
      current = line;
      currentKind = /^\d/u.test(line) ? "clause" : "point";
      continue;
    }

    if (startsStructure) {
      if (/^(?:\d+[.)]|[a-zđ][.)]|[-–—])$/iu.test(current)) {
        current = `${current} ${line}`;
        continue;
      }
      flush();
      current = line;
      currentKind = blockKind(line);
      continue;
    }

    current = current ? `${current} ${line}` : line;
  }
  flush();
  return blocks;
}

export function splitLegalBlocks(value: string): LegalBlock[] {
  return looksLikePreamble(value) ? splitPreambleBlocks(value) : splitStandardLegalBlocks(value);
}
