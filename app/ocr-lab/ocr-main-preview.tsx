"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { OcrPreviewBlock } from "@/lib/legal/ocr-layout";
import {
  auditOcrMainLayout,
  buildOcrMainProvisions,
  comparableOcrText,
  ocrBlockText,
  type OcrMainPreviewEntry,
} from "@/lib/legal/ocr-main-layout";
import type { PageResult } from "./ocr-lab-types";

const SPEECH_START_EVENT = "ocr-main-speech-start";

type RenderTableBlock = Extract<OcrPreviewBlock, { kind: "table" }> & {
  continued?: boolean;
  notices?: string[];
};

function requestSpeechStart(id: string) {
  window.dispatchEvent(new CustomEvent(SPEECH_START_EVENT, { detail: { id } }));
}

function speechKey(event: KeyboardEvent<HTMLElement>, id: string) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  requestSpeechStart(id);
}

function tableColumnRole(header: string, index: number) {
  const value = comparableOcrText(header);
  if (value === "stt" || value === "so thu tu" || index === 0) return "index";
  if (value.includes("noi dung") || value.includes("ho va ten") || value.includes("tieu chi")) return "content";
  if (value === "dat") return "pass";
  if (value === "khong dat") return "fail";
  if (value.includes("nhan xet") || value.includes("danh gia")) return "comment";
  if (value.includes("giai trinh") || value.includes("bo sung")) return "request";
  return "other";
}

function TableBlock({ block, page, speechId }: { block: RenderTableBlock; page: number; speechId: string }) {
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
      className="ocrDocTableGroup ocrMainSearchable"
      data-page={page}
      data-search-text={comparableOcrText(block.rows.flat().join(" "))}
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
            {body.map((row, rowIndex) => {
              const rowSpeechId = `${speechId}-row-${rowIndex}`;
              return (
                <tr
                  className="ocrSpeechUnit"
                  data-page={page}
                  data-speech-id={rowSpeechId}
                  data-speech-kind="table-row"
                  key={`body-${rowIndex}-${row[0] ?? ""}`}
                  role="button"
                  tabIndex={0}
                  title="Đọc từ hàng này"
                  onClick={() => requestSpeechStart(rowSpeechId)}
                  onKeyDown={(event) => speechKey(event, rowSpeechId)}
                >
                  {row.map((cell, cellIndex) => {
                    const rowHeader = cellIndex === 0 && block.firstColumn !== "auto";
                    const checkbox = /^(?:□|☐|☑|✓|✔)(?:\s+(?:□|☐|☑|✓|✔))*$/u.test(cell.trim());
                    const className = checkbox ? "ocrDocTableCheckboxCell" : undefined;
                    return rowHeader
                      ? <th scope="row" className={className} key={cellIndex}>{cell || "\u00a0"}</th>
                      : <td className={className} key={cellIndex}>{cell || "\u00a0"}</td>;
                  })}
                </tr>
              );
            })}
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

function PreviewBlock({ entry, speechId }: { entry: OcrMainPreviewEntry; speechId: string }) {
  const { block, page, preambleRole = "" } = entry;
  if (block.kind === "table") return <TableBlock block={block as RenderTableBlock} page={page} speechId={speechId} />;

  const text = ocrBlockText(block);
  const data = {
    "data-page": page,
    "data-search-text": comparableOcrText(text),
    "data-speech-id": speechId,
    "data-speech-kind": "text",
  };
  const role = preambleRole ? ` ${preambleRole}` : "";
  const common = {
    role: "button",
    tabIndex: 0,
    title: "Đọc từ đoạn này",
    onClick: () => requestSpeechStart(speechId),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => speechKey(event, speechId),
  };

  if (block.kind === "checkbox") {
    return (
      <div className={`legalBlock paragraph ocrDocCheckbox ocrSpeechUnit ocrMainSearchable${role}`} {...data} {...common}>
        <span aria-hidden="true">{block.checked ? "☑" : "☐"}</span><p>{block.text}</p>
      </div>
    );
  }
  if (block.kind === "field") {
    return (
      <div className={`legalBlock paragraph ocrDocField ocrSpeechUnit ocrMainSearchable${role}`} {...data} {...common}>
        <span>{block.label}</span><i aria-hidden="true" />{block.value ? <strong>{block.value}</strong> : null}
      </div>
    );
  }
  if (block.kind === "list") {
    return (
      <div className={`legalBlock point ocrDocList ocrSpeechUnit ocrMainSearchable${role}`} {...data} {...common}>
        <strong>{block.marker}</strong><p>{block.text}</p>
      </div>
    );
  }
  if (block.kind === "note") {
    return <aside className={`legalBlock paragraph ocrDocNote ocrSpeechUnit ocrMainSearchable${role}`} {...data} {...common}>{block.text}</aside>;
  }
  const kind = block.kind === "heading" || block.kind === "title" ? "heading" : "paragraph";
  return <div className={`legalBlock ${kind} ocrSpeechUnit ocrMainSearchable${role}`} {...data} {...common}>{text}</div>;
}

export default function OcrMainPreview({ pages }: { pages: PageResult[] }) {
  const sourcePages = useMemo(() => pages.map((page) => ({ page: page.page, text: page.text })), [pages]);
  const provisions = useMemo(() => buildOcrMainProvisions(sourcePages), [sourcePages]);
  const audit = useMemo(() => auditOcrMainLayout(provisions, sourcePages), [provisions, sourcePages]);
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
    const normalized = comparableOcrText(query);
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
      const haystack = node.dataset.searchText ?? comparableOcrText(node.textContent ?? "");
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

        <p className="ocrSpeechInstruction">Chạm vào tiêu đề Điều, một đoạn văn hoặc một hàng trong bảng để bắt đầu đọc đúng từ vị trí đó.</p>
        <section className="ocrLayoutAudit" aria-label="Kiểm tra nhanh bố cục OCR">
          {audit.map((check) => (
            <article className={`ocrLayoutAuditItem is-${check.status}`} key={check.id}>
              <span>{check.status === "pass" ? "✓" : "!"}</span>
              <div><strong>{check.label}</strong><p>{check.detail}</p></div>
            </article>
          ))}
        </section>

        <div className="readerText">
          {provisions.map((provision, provisionIndex) => {
            const headingSpeechId = `${provision.key}-heading`;
            return (
              <section className={`legalProvision ocrMainProvision ocrMainProvision--${provision.key}`} data-page={provision.startPage} key={provision.key}>
                <h4
                  className="ocrSpeechUnit ocrMainSearchable"
                  data-page={provision.startPage}
                  data-search-text={comparableOcrText(provision.title)}
                  data-speech-id={headingSpeechId}
                  data-speech-kind="heading"
                  role="button"
                  tabIndex={0}
                  title="Đọc từ tiêu đề này"
                  onClick={() => requestSpeechStart(headingSpeechId)}
                  onKeyDown={(event) => speechKey(event, headingSpeechId)}
                >
                  <span>{String(provisionIndex + 1).padStart(2, "0")}.</span>{provision.title}
                </h4>
                <div className="legalBlocks">
                  {provision.entries.map((entry, index) => (
                    <PreviewBlock entry={entry} speechId={`${provision.key}-entry-${index}`} key={`${provision.key}-${entry.page}-${index}`} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <p className="verificationNote">Đây là bố cục xem trước giống trang chính. Nội dung OCR chưa được ghi vào kho văn bản và vẫn cần vượt qua kiểm tra chất lượng trước khi merge.</p>
      </section>
    </article>
  );
}
