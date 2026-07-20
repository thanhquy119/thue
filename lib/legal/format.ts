export type LegalBlock = {
  text: string;
  kind: "paragraph" | "clause" | "point" | "heading";
};

function blockKind(value: string): LegalBlock["kind"] {
  if (/^(?:CHƯƠNG|Chương|MỤC|Mục|PHẦN|Phần)\s+/u.test(value)) return "heading";
  if (/^\d+[.)]\s+/u.test(value)) return "clause";
  if (/^[a-zđ][.)]\s+/iu.test(value)) return "point";
  return "paragraph";
}

export function splitLegalBlocks(value: string): LegalBlock[] {
  const lines = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim());

  const blocks: LegalBlock[] = [];
  let current = "";
  let currentKind: LegalBlock["kind"] = "paragraph";

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
    if (!currentKind) currentKind = blockKind(line);
  }
  flush();
  return blocks;
}
