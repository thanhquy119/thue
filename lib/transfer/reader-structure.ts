import { splitLegalBlocks, type LegalBlock } from "../legal/format.ts";

export type TransferReaderItem = {
  id: string;
  title: string;
  blocks: LegalBlock[];
};

function normalizeReaderText(value: string) {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function safeId(value: string, index: number) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/đ/giu, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 60);
  return slug || `phan-${index + 1}`;
}

function inferredHeading(body: string) {
  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
  const first = lines[0] ?? "";
  if (!first || first.length > 180) return { heading: null, body };
  if (/^(?:\d+[.)]|[a-zđ][.)]|[-–—]|Chương\s+|Mục\s+|Phần\s+)/iu.test(first)) {
    return { heading: null, body };
  }
  return {
    heading: first,
    body: lines.slice(1).join("\n"),
  };
}

export function splitTransferredReaderItems(
  input: string,
  fallbackTitle = "Nội dung tài liệu",
): TransferReaderItem[] {
  const text = normalizeReaderText(input);
  if (!text) return [];

  const articlePattern = /^\s*Điều\s+(\d+[a-zA-Z]?)\s*[.:]?\s*([^\n]*)$/gimu;
  const matches = [...text.matchAll(articlePattern)];
  if (!matches.length) {
    const blocks = splitLegalBlocks(text);
    return blocks.length ? [{ id: "noi-dung", title: fallbackTitle, blocks }] : [];
  }

  const items: TransferReaderItem[] = [];
  const firstStart = matches[0].index ?? 0;
  const preamble = normalizeReaderText(text.slice(0, firstStart));
  if (preamble) {
    const blocks = splitLegalBlocks(preamble);
    if (blocks.length) items.push({ id: "phan-mo-dau", title: "Phần mở đầu", blocks });
  }

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index ?? 0;
    const headingEnd = start + match[0].length;
    const nextStart = matches[index + 1]?.index ?? text.length;
    const identifier = `Điều ${match[1]}`;
    let heading = match[2]?.trim() || null;
    let body = normalizeReaderText(text.slice(headingEnd, nextStart));
    if (!heading && body) {
      const inferred = inferredHeading(body);
      heading = inferred.heading;
      body = normalizeReaderText(inferred.body);
    }
    const blocks = splitLegalBlocks(body || heading || identifier);
    if (!blocks.length) continue;
    const title = [identifier, heading].filter(Boolean).join(" — ");
    items.push({ id: safeId(identifier, index), title, blocks });
  }

  return items.length ? items : [{ id: "noi-dung", title: fallbackTitle, blocks: splitLegalBlocks(text) }];
}
