"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { OcrPreviewBlock } from "@/lib/legal/ocr-layout";
import { buildOcrPreviewPages } from "@/lib/legal/ocr-page-layout";
import type { PageResult } from "./ocr-lab-types";

type RenderTableBlock = Extract<OcrPreviewBlock, { kind: "table" }> & {
  continued?: boolean;
  notices?: string[];
};

type PreviewEntry = {
  block: OcrPreviewBlock;
  page: number;
  preambleRole?: string;
};

type PreviewProvision = {
  key: string;
  title: string;
  startPage: number;
  entries: PreviewEntry[];
};

function comparable(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/giu, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function blockText(block: OcrPreviewBlock) {
  if (block.kind === "field") return [block.label, block.value].filter(Boolean).join(" ");
  if (block.kind === "list") return `${block.marker} ${block.text}`;
  if (block.kind === "table") return block.rows.flat().filter(Boolean).join(" ");
  return block.text;
}

function isArticleHeading(block: OcrPreviewBlock) {
  if (block.kind === "article") return true;
  if (block.kind !== "paragraph" && block.kind !== "heading") return false;
  return /^Điều\s+\d+[a-z]?\b\s*[.：:\-–—]/iu.test(block.text);
}

function assignPreambleRoles(entries: PreviewEntry[]) {
  const texts = entries.map((entry) => comparable(blockText(entry.block)));
  const national = texts.findIndex((text) => text.includes("cong hoa xa hoi chu nghia viet nam"));
  const motto = texts.findIndex((text) => text.includes("doc lap") && text.includes("tu do") && text.includes("hanh phuc"));
  const number = texts.findIndex((text) => /^so\s+\d/u.test(text) || /^so$/u.test(text));
  const dateline = texts.findIndex((text) => /(?:ha noi|thanh pho|tinh).*ngay.*thang.*nam/u.test(text));
  const type = texts.findIndex((text) => /^(?:nghi dinh|thong tu|nghi quyet|quyet dinh|luat|thong bao)$/u.test(text));

  const authority = texts
    .map((text, index) => ({ text, index }))
    .find(({ text, index }) => {
      if (!text || [national, motto, number, dateline, type].includes(index)) return false;
      if (index > Math.max(number >= 0 ? number : 8, national >= 0 ? national : 8)) return false;
      if (/van ban quy pham phap luat|sao y|nguyen van/u.test(text)) return false;
      return /^(?:chinh phu|bo |uy ban|hoi dong|quoc hoi|chu tich|toa an|vien kiem sat)/u.test(text);
    })?.index ?? -1;

  if (authority >= 0) entries[authority]!.preambleRole = "preamble-authority";
  if (national >= 0) entries[national]!.preambleRole = "preamble-national";
  if (motto >= 0) entries[motto]!.preambleRole = "preamble-motto";
  if (number >= 0) entries[number]!.preambleRole = "preamble-number";
  if (dateline >= 0) entries[dateline]!.preambleRole = "preamble-dateline";
  if (type >= 0) entries[type]!.preambleRole = "preamble-type";

  if (type >= 0) {
    for (let index = type + 1; index < entries.length; index += 1) {
      const text = texts[index] ?? "";
      if (/^(?:can cu|theo de nghi|bo truong|chinh phu ban hanh)/u.test(text)) break;
      if (text) entries[index]!.preambleRole = "preamble-title";
    }
  }
}

function prepareProvisions(pages: PageResult[]) {
  const preparedPages = buildOcrPreviewPages(
    pages.map((page) => ({ page: page.page, text: page.text })),
  );
  const provisions: PreviewProvision[] = [];
  let current: PreviewProvision = {
    key: "preamble",
    title: "Phần mở đầu",
    startPage: preparedPages[0]?.page ?? 1,
    entries: [],
  };

  const flush = () => {
    if (current.entries.length) provisions.push(current);
  };

  for (const prepared of preparedPages) {
    for (const block of prepared.blocks) {
      if (isArticleHeading(block)) {
        flush();
        current = {
          key: `article-${prepared.page}-${provisions.length}`,
          title: blockText(block),
          startPage: prepared.page,
          entries: [],
        };
      } else {
        current.entries.push({ block, page: prepared.page });
      }
    }
  }
  flush();
  if (provisions[0]?.key === "preamble") assignPreambleRoles(provisions[0].entries);
  return provisions;
}

function tableColumnRole(header: string, index: number) {
  const value = comparable(header);
  if (value === "stt" || value === "so thu tu" || index === 0) return "index";
  if (value.includes("noi dung") || value.includes("ho va ten") || value.includes("tieu chi")) return "content";
  if (value === "dat") return "pass";
  if (value === "khong dat") return "fail";
  if (value.includes("nhan xet") || value.includes("danh gia")) return "comment";
  if (value.includes("giai trinh") || value.includes("bo sung")) return "request";
  return "other";
}

function TableBlock({ block, page }: { block: RenderTableBlock; page: number }) {
  const headers = block.rows.slice(0, block.headerRows);
  const body = block.rows.slice(block.headerRows);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const signature = `${block.columnCount}:${block.rows.map((row) => row.join("¦")).join("¶")}`;
  const roleHeaders = headers[0] ?? Array.from({ length: block.columnCount }, () => "");

  useEffect(() => {
    if (wrapperRef.current) wrapperRef.current.scrollLeft = 0;
  }, [signature]);

  return (
    <div
      className="ocrDocTableGroup ocrSpeechTable ocrMainSearchable"
      data-page={page}
      data-search-text={comparable(block.rows.flat().join(" "))}
    >
      {block.continued ? <p className="ocrDocTableContinuation">Bảng tiếp theo từ trang trước</p> : null}
      <div className="ocrDocTableWrap" ref={wrapperRef}>
        <table className={`ocrDocTable ocrDocTable--${block.firstColumn}`} data-columns={block.columnCount}>
          <colgroup>
            {Array.from({ length: block.columnCount }, (_, index) => (
              <col className={`ocrDocTableColumn--${tableColumnRole(roleHeaders[index] ?? "", index)}`} key={index} />
            ))}
          </colgroup>
          {headers.length ? (
            <thead>
              {headers.map((row, rowIndex) => (
                <tr key={`header-${rowIndex}`}>
                  {row.map((cell, cellIndex) => <th scope="col" key={cellIndex}>{cell || "\u00a0"}</th>)}
                </tr>
              ))}
            </thead>
          ) : null}
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={`body-${rowIndex}-${row[0] ?? ""}`}>
                {row.map((cell, cellIndex) => {
                  const rowHeader = cellIndex === 0 && block.firstColumn !== "auto";
                  const checkbox = /^(?:□|☐|☑|✓|✔)(?:\s+(?:□|☐|☑|✓|✔))*$/u.test(cell.trim());
                  const className = checkbox ? "ocrDocTableCheckboxCell" : undefined;
                  return rowHeader
                    ? <th scope="row" className={className} key={cellIndex}>{cell || "\u00a0"}</th>
                    : <td className={className} key={cellIndex}>{cell || "\u00a0"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.notices?.length ? (
        <div className="ocrDocTableNotices">
          {[...new Set(block.notices)].map((notice) => <p key={notice}>{notice}</p>)}
        </div>
      ) : null}
    </div>
  );
}

function PreviewBlock({ entry }: { entry: PreviewEntry }) {
  const { block, page, preambleRole = "" } = entry;
  if (block.kind === "table") return <TableBlock block={block as RenderTableBlock} page={page} />;

  const text = blockText(block);
  const data = { "data-page": page, "data-search-text": comparable(text) };
  const role = preambleRole ? ` ${preambleRole}` : "";

  if (block.kind === "checkbox") {
    return (
      <div className={`legalBlock paragraph ocrDocCheckbox ocrSpeechSegment ocrMainSearchable${role}`} {...data}>
        <span aria-hidden="true">{block.checked ? "☑" : "☐"}</span><p>{block.text}</p>
      </div>
    );
  }
  if (block.kind === "field") {
    return (
      <div className={`legalBlock paragraph ocrDocField ocrSpeechSegment ocrMainSearchable${role}`} {...data}>
        <span>{block.label}</span><i aria-hidden="true" />{block.value ? <strong>{block.value}</strong> : null}
      </div>
    );
  }
  if (block.kind === "list") {
    return (
      <div className={`legalBlock point ocrDocList ocrSpeechSegment ocrMainSearchable${role}`} {...data}>
        <strong>{block.marker}</strong><p>{block.text}</p>
      </div>
    );
  }
  if (block.kind === "note") {
    return <aside className={`legalBlock paragraph ocrDocNote ocrSpeechSegment ocrMainSearchable${role}`} {...data}>{block.text}</aside>;
  }
  const kind = block.kind === "heading" || block.kind === "title" ? "heading" : "paragraph";
  return <div className={`legalBlock ${kind} ocrSpeechSegment ocrMainSearchable${role}`} {...data}>{text}</div>;
}

export default function OcrMainPreview({ pages }: { pages: PageResult[] }) {
  const provisions = useMemo(() => prepareProvisions(pages), [pages]);
  const rootRef = useRef<HTMLElement>(null);
  const matchesRef = useRef<HTMLElement[]>([]);
  const previousQueryRef = useRef("");
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(-1);
  const [matchCount, setMatchCount] = useState(0);

  useEffect(() => {
    matchesRef.current = [];
    previousQueryRef.current = "";
    setMatchIndex(-1);
    setMatchCount(0);
  }, [pages]);

  function clearMatches() {
    rootRef.current?.querySelectorAll<HTMLElement>(".isOcrSearchMatch").forEach((node) => {
      node.classList.remove("isOcrSearchMatch", "isOcrSearchCurrent");
    });
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = comparable(query);
    if (!normalized) {
      clearMatches();
      matchesRef.current = [];
      previousQueryRef.current = "";
      setMatchIndex(-1);
      setMatchCount(0);
      return;
    }

    if (previousQueryRef.current === normalized && matchesRef.current.length) {
      const next = (matchIndex + 1) % matchesRef.current.length;
      matchesRef.current.forEach((node, index) => node.classList.toggle("isOcrSearchCurrent", index === next));
      matchesRef.current[next]?.scrollIntoView({ behavior: "smooth", block: "center" });
      setMatchIndex(next);
      return;
    }

    clearMatches();
    const tokens = normalized.split(" ").filter(Boolean);
    const nodes = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(".ocrMainSearchable") ?? []);
    const matches = nodes.filter((node) => {
      const haystack = node.dataset.searchText ?? comparable(node.textContent ?? "");
      return tokens.every((token) => haystack.includes(token));
    });
    matches.forEach((node, index) => {
      node.classList.add("isOcrSearchMatch");
      node.classList.toggle("isOcrSearchCurrent", index === 0);
    });
    matchesRef.current = matches;
    previousQueryRef.current = normalized;
    setMatchCount(matches.length);
    setMatchIndex(matches.length ? 0 : -1);
    matches[0]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <article className="ocrMainPreview documentDetail" ref={rootRef}>
      <section className="readerBlock">
        <div className="readerHeading ocrMainReaderHeading">
          <div><p className="sectionLabel">Nguyên văn sau OCR · Bản xem thử</p><h3>Toàn bộ nội dung văn bản</h3></div>
          <form className="ocrDocumentSearch" onSubmit={search}>
            <label className="srOnly" htmlFor="ocr-document-search">Tìm trong văn bản OCR</label>
            <input id="ocr-document-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm trong văn bản..." />
            <button type="submit">{matchCount ? `${matchIndex + 1}/${matchCount}` : "Tìm"}</button>
          </form>
        </div>

        <div className="readerText">
          {provisions.map((provision, provisionIndex) => (
            <section className="legalProvision ocrMainProvision" data-page={provision.startPage} key={provision.key}>
              <h4 className="ocrSpeechSegment ocrMainSearchable" data-page={provision.startPage} data-search-text={comparable(provision.title)}>
                <span>{String(provisionIndex + 1).padStart(2, "0")}.</span>{provision.title}
              </h4>
              <div className="legalBlocks">
                {provision.entries.map((entry, index) => <PreviewBlock entry={entry} key={`${provision.key}-${entry.page}-${index}`} />)}
              </div>
            </section>
          ))}
        </div>

        <p className="verificationNote">Đây là bố cục xem trước giống trang chính. Nội dung OCR chưa được ghi vào kho văn bản và vẫn cần vượt qua kiểm tra chất lượng trước khi merge.</p>
      </section>
    </article>
  );
}
