import type { OcrPreviewBlock } from "./ocr-layout.ts";
import { buildOcrPreviewPages } from "./ocr-page-layout.ts";

export type OcrPreambleRole =
  | "preamble-authority"
  | "preamble-national"
  | "preamble-motto"
  | "preamble-number"
  | "preamble-dateline"
  | "preamble-type"
  | "preamble-title";

export type OcrMainPreviewEntry = {
  block: OcrPreviewBlock;
  page: number;
  preambleRole?: OcrPreambleRole;
};

export type OcrMainPreviewProvision = {
  key: string;
  title: string;
  startPage: number;
  entries: OcrMainPreviewEntry[];
};

export type OcrMainLayoutCheck = {
  id: string;
  label: string;
  status: "pass" | "warn";
  detail: string;
};

export function comparableOcrText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/giu, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function ocrBlockText(block: OcrPreviewBlock) {
  if (block.kind === "field") return [block.label, block.value].filter(Boolean).join(" ");
  if (block.kind === "list") return `${block.marker} ${block.text}`.trim();
  if (block.kind === "table") return block.rows.flat().filter(Boolean).join(" ");
  return block.text;
}

function textBlock(text: string): OcrPreviewBlock {
  return { kind: "paragraph", text: text.replace(/\s+/g, " ").trim() };
}

function isArticleHeading(block: OcrPreviewBlock) {
  if (block.kind === "article") return true;
  if (block.kind !== "paragraph" && block.kind !== "heading" && block.kind !== "title") return false;
  const text = block.text.trim();
  if (text.length > 320) return false;
  return /^Điều\s+\d+[a-z]?(?:\s*[.：:\-–—]|\s*$|\s+[A-ZÀ-ỸĐ])/iu.test(text);
}

function shouldJoinPreamblePair(left: string, right: string) {
  const a = comparableOcrText(left);
  const b = comparableOcrText(right);
  if (!a || !b) return false;
  if (/^(?:bo|uy ban nhan dan|hoi dong nhan dan|toa an nhan dan|vien kiem sat nhan dan)$/u.test(a)) {
    return b.length <= 90 && !/^(?:cong hoa|doc lap|so |ngay |nghi dinh|thong tu|nghi quyet|quyet dinh|luat|can cu)/u.test(b);
  }
  if (a === "so" && /^\d/u.test(b)) return true;
  if (a.includes("cong hoa xa hoi") && !a.includes("chu nghia viet nam") && b.includes("chu nghia viet nam")) return true;
  if (a.includes("doc lap") && a.includes("tu do") && !a.includes("hanh phuc") && b.includes("hanh phuc")) return true;
  return false;
}

function mergeSplitPreambleEntries(entries: OcrMainPreviewEntry[]) {
  const output: OcrMainPreviewEntry[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index];
    const next = entries[index + 1];
    if (current && next && shouldJoinPreamblePair(ocrBlockText(current.block), ocrBlockText(next.block))) {
      output.push({
        block: textBlock(`${ocrBlockText(current.block)} ${ocrBlockText(next.block)}`),
        page: current.page,
      });
      index += 1;
      continue;
    }
    if (current) output.push({ ...current, block: { ...current.block } as OcrPreviewBlock });
  }
  return output;
}

function isPreambleBodyStart(text: string) {
  const value = comparableOcrText(text);
  return /^(?:can cu|theo de nghi|xet de nghi|chinh phu ban hanh|bo truong ban hanh|quyet dinh|nghi quyet)/u.test(value);
}

function findDocumentType(entries: OcrMainPreviewEntry[]) {
  return entries.findIndex((entry) => {
    const value = comparableOcrText(ocrBlockText(entry.block));
    return /^(?:nghi dinh|thong tu|nghi quyet|quyet dinh|luat|thong bao)(?:\s+so\b.*)?$/u.test(value);
  });
}

function collapsePreambleTitle(entries: OcrMainPreviewEntry[]) {
  const typeIndex = findDocumentType(entries);
  if (typeIndex < 0) return entries;
  const titleIndexes: number[] = [];
  for (let index = typeIndex + 1; index < entries.length; index += 1) {
    const text = ocrBlockText(entries[index]!.block).trim();
    if (!text) continue;
    if (isPreambleBodyStart(text) || isArticleHeading(entries[index]!.block)) break;
    titleIndexes.push(index);
  }
  if (titleIndexes.length <= 1) return entries;

  const first = titleIndexes[0]!;
  const title = titleIndexes.map((index) => ocrBlockText(entries[index]!.block)).join(" ");
  const skipped = new Set(titleIndexes.slice(1));
  return entries
    .map((entry, index) => index === first ? { ...entry, block: textBlock(title) } : entry)
    .filter((_, index) => !skipped.has(index));
}

function assignPreambleRoles(entries: OcrMainPreviewEntry[]) {
  const texts = entries.map((entry) => comparableOcrText(ocrBlockText(entry.block)));
  const national = texts.findIndex((text) => text.includes("cong hoa xa hoi chu nghia viet nam"));
  const motto = texts.findIndex((text) => text.includes("doc lap") && text.includes("tu do") && text.includes("hanh phuc"));
  const number = texts.findIndex((text) => /^so\s+\d/u.test(text) || text === "so");
  const dateline = texts.findIndex((text) => /\bngay\s+\d{1,2}\s+thang\s+\d{1,2}\s+nam\s+\d{4}\b/u.test(text) || /\bngay\s+\d{1,2}[\s/.-]+\d{1,2}[\s/.-]+\d{4}\b/u.test(text));
  const type = findDocumentType(entries);

  const authority = texts
    .map((text, index) => ({ text, index }))
    .find(({ text, index }) => {
      if (!text || [national, motto, number, dateline, type].includes(index)) return false;
      const boundary = Math.max(number >= 0 ? number : 10, national >= 0 ? national : 10);
      if (index > boundary) return false;
      if (/van ban quy pham phap luat|sao y|nguyen van/u.test(text)) return false;
      return /^(?:chinh phu|quoc hoi|chu tich nuoc|bo\s+|uy ban nhan dan|hoi dong nhan dan|toa an nhan dan|vien kiem sat nhan dan)/u.test(text);
    })?.index ?? -1;

  if (authority >= 0) entries[authority]!.preambleRole = "preamble-authority";
  if (national >= 0) entries[national]!.preambleRole = "preamble-national";
  if (motto >= 0) entries[motto]!.preambleRole = "preamble-motto";
  if (number >= 0) entries[number]!.preambleRole = "preamble-number";
  if (dateline >= 0) entries[dateline]!.preambleRole = "preamble-dateline";
  if (type >= 0) entries[type]!.preambleRole = "preamble-type";

  if (type >= 0) {
    for (let index = type + 1; index < entries.length; index += 1) {
      const text = ocrBlockText(entries[index]!.block).trim();
      if (!text) continue;
      if (isPreambleBodyStart(text) || isArticleHeading(entries[index]!.block)) break;
      entries[index]!.preambleRole = "preamble-title";
    }
  }
}

function preparePreambleEntries(entries: OcrMainPreviewEntry[]) {
  const merged = collapsePreambleTitle(mergeSplitPreambleEntries(entries));
  assignPreambleRoles(merged);
  return merged;
}

export function buildOcrMainProvisions(pages: Array<{ page: number; text: string }>): OcrMainPreviewProvision[] {
  const preparedPages = buildOcrPreviewPages(pages);
  const firstPage = preparedPages[0]?.page ?? 1;
  const startsAtBeginning = firstPage === 1;
  const provisions: OcrMainPreviewProvision[] = [];
  let current: OcrMainPreviewProvision = {
    key: startsAtBeginning ? "preamble" : "continuation",
    title: startsAtBeginning ? "Phần mở đầu" : `Nội dung tiếp theo · Trang ${firstPage}`,
    startPage: firstPage,
    entries: [],
  };

  const flush = () => {
    if (current.entries.length || current.key.startsWith("article-")) provisions.push(current);
  };

  for (const prepared of preparedPages) {
    for (const block of prepared.blocks) {
      if (isArticleHeading(block)) {
        flush();
        current = {
          key: `article-${prepared.page}-${provisions.length}`,
          title: ocrBlockText(block),
          startPage: prepared.page,
          entries: [],
        };
      } else {
        current.entries.push({ block, page: prepared.page });
      }
    }
  }
  flush();

  if (startsAtBeginning && provisions[0]?.key === "preamble") {
    provisions[0].entries = preparePreambleEntries(provisions[0].entries);
  }
  return provisions;
}

export function auditOcrMainLayout(
  provisions: OcrMainPreviewProvision[],
  pages: Array<{ page: number; text: string }>,
): OcrMainLayoutCheck[] {
  const checks: OcrMainLayoutCheck[] = [];
  const startsAtBeginning = (pages[0]?.page ?? 1) === 1;
  const preamble = provisions[0]?.key === "preamble" ? provisions[0] : null;

  if (startsAtBeginning) {
    const roles = new Set(preamble?.entries.map((entry) => entry.preambleRole).filter(Boolean) ?? []);
    const required: Array<[OcrPreambleRole, string]> = [
      ["preamble-authority", "Cơ quan ban hành"],
      ["preamble-national", "Quốc hiệu"],
      ["preamble-motto", "Tiêu ngữ"],
      ["preamble-number", "Số hiệu"],
      ["preamble-type", "Loại văn bản"],
      ["preamble-title", "Tên văn bản"],
    ];
    const missing = required.filter(([role]) => !roles.has(role)).map(([, label]) => label);
    checks.push({
      id: "preamble",
      label: "Phần mở đầu",
      status: missing.length ? "warn" : "pass",
      detail: missing.length ? `Chưa nhận diện chắc chắn: ${missing.join(", ")}.` : "Đã nhận diện đủ các thành phần bắt buộc của phần mở đầu.",
    });
  } else {
    checks.push({
      id: "continuation",
      label: "Đoạn trích giữa văn bản",
      status: "pass",
      detail: "Bản xem thử bắt đầu giữa văn bản nên không ép nhận diện phần mở đầu.",
    });
  }

  const tables = provisions.flatMap((provision) => provision.entries)
    .map((entry) => entry.block)
    .filter((block): block is Extract<OcrPreviewBlock, { kind: "table" }> => block.kind === "table");
  const malformed = tables.filter((table) => table.rows.some((row) => row.length !== table.columnCount));
  const emptyBody = tables.filter((table) => table.rows.length <= table.headerRows);
  checks.push({
    id: "tables",
    label: "Cấu trúc bảng",
    status: malformed.length || emptyBody.length ? "warn" : "pass",
    detail: malformed.length
      ? `${malformed.length} bảng có hàng không khớp số cột.`
      : emptyBody.length
        ? `${emptyBody.length} bảng chưa có hàng nội dung.`
        : tables.length
          ? `${tables.length} bảng có số cột nhất quán và có hàng nội dung.`
          : "Không có bảng trong phạm vi đang xem.",
  });

  const unreadable = pages.reduce((total, page) => total + (page.text.match(/\[không đọc rõ\]/giu)?.length ?? 0), 0);
  checks.push({
    id: "unclear",
    label: "Vùng chưa đọc chắc chắn",
    status: unreadable ? "warn" : "pass",
    detail: unreadable ? `Còn ${unreadable} vị trí [không đọc rõ] cần đối chiếu thủ công.` : "Không còn ký hiệu [không đọc rõ] trong phạm vi này.",
  });

  const articles = provisions.filter((provision) => provision.key.startsWith("article-"));
  checks.push({
    id: "articles",
    label: "Điều và nội dung",
    status: articles.some((article) => !article.title.trim()) ? "warn" : "pass",
    detail: articles.length ? `Đã tách ${articles.length} Điều/mục nội dung.` : "Chưa thấy tiêu đề Điều trong phạm vi đang xem.",
  });
  return checks;
}
