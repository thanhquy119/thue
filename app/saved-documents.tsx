"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { loadReadingStates, type ReadingStateRecord } from "./client-storage";

const READING_STATE_EVENT = "thue-ro-reading-state";

function mergeRecord(records: ReadingStateRecord[], nextRecord: ReadingStateRecord) {
  return records.some((record) => record.documentId === nextRecord.documentId)
    ? records.map((record) => (record.documentId === nextRecord.documentId ? nextRecord : record))
    : [...records, nextRecord];
}

export default function SavedDocuments() {
  const [topbar, setTopbar] = useState<HTMLElement | null>(null);
  const [records, setRecords] = useState<ReadingStateRecord[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setTopbar(document.querySelector<HTMLElement>(".topbar"));
    loadReadingStates().then(setRecords).catch(() => undefined);

    // Không dùng lại kết quả đã lưu trước các thay đổi về số hiệu, cơ quan ban hành và hiệu lực.
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith("thue-ro-search-")) window.sessionStorage.removeItem(key);
    }

    const onReadingState = (event: Event) => {
      const record = (event as CustomEvent<ReadingStateRecord>).detail;
      if (record?.documentId) setRecords((current) => mergeRecord(current, record));
    };
    window.addEventListener(READING_STATE_EVENT, onReadingState);
    return () => window.removeEventListener(READING_STATE_EVENT, onReadingState);
  }, []);

  const saved = useMemo(
    () =>
      records
        .filter((record) => record.bookmarked && record.documentNumber)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [records],
  );

  function openDocument(number: string) {
    setOpen(false);
    const input = document.getElementById("legal-search") as HTMLInputElement | null;
    const form = input?.closest("form") as HTMLFormElement | null;
    if (!input || !form) return;

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, number);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    window.setTimeout(() => form.requestSubmit(), 0);
  }

  return (
    <>
      {topbar
        ? createPortal(
            <button className="savedLink" type="button" onClick={() => setOpen(true)} aria-label="Mở các văn bản đã lưu">
              Đã lưu{saved.length ? <span>{saved.length}</span> : null}
            </button>,
            topbar,
          )
        : null}

      {open ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-labelledby="saved-title" onClick={() => setOpen(false)}>
          <section className="savedSheet" onClick={(event) => event.stopPropagation()}>
            <button className="closeButton" type="button" onClick={() => setOpen(false)} aria-label="Đóng">×</button>
            <p className="eyebrow">Thư viện cá nhân</p>
            <h2 id="saved-title">Văn bản đã lưu</h2>

            {saved.length ? (
              <div className="savedList">
                {saved.map((record) => (
                  <button className="savedDocument" type="button" key={record.documentId} onClick={() => openDocument(record.documentNumber as string)}>
                    <strong>{record.documentNumber}</strong>
                    <span>{record.documentTitle || "Mở lại toàn văn"}</span>
                    <small>{record.progress.provisionId ? "Tiếp tục từ vị trí đã đọc" : "Mở toàn văn"} →</small>
                  </button>
                ))}
              </div>
            ) : (
              <div className="savedEmpty">
                <strong>Chưa có văn bản nào được lưu.</strong>
                <p>Mở một văn bản rồi nhấn “＋ Lưu” để xem lại trong những lần sau.</p>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
