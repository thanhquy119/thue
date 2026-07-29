"use client";

import { upload } from "@vercel/blob/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { splitLegalBlocks } from "@/lib/legal/format";
import type { TransferFileRecord } from "@/lib/transfer/core";

const STORAGE_KEY = "thue-transfer-key-v1";

function generateKey() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(36).padStart(2, "0")).join("").toUpperCase();
}

function displayKey(value: string) {
  return value.match(/.{1,6}/g)?.join("-") ?? value;
}

function formatSize(bytes: number) {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function statusText(file: TransferFileRecord) {
  if (file.status === "processing") return "Đang chuyển thành nội dung nghe…";
  if (file.status === "ocr_partial") return `Đã OCR ${file.processedPages}/${file.totalPages} trang`;
  if (file.status === "ready") return "Sẵn sàng đọc và nghe";
  if (file.status === "failed") return file.error || "Xử lý file thất bại";
  return "Chưa hỗ trợ";
}

export default function TransferPage() {
  const [key, setKey] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [mailboxId, setMailboxId] = useState("");
  const [files, setFiles] = useState<TransferFileRecord[]>([]);
  const [selected, setSelected] = useState<{ meta: TransferFileRecord; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const speechIndexRef = useRef(0);
  const speechSessionRef = useRef(0);

  const blocks = useMemo(() => selected ? splitLegalBlocks(selected.text) : [], [selected]);

  const connect = useCallback(async (rawKey: string) => {
    const normalized = rawKey.replace(/[^a-z0-9]/giu, "").toUpperCase();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/transfer/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: normalized }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Không thể kết nối.");
      localStorage.setItem(STORAGE_KEY, normalized);
      setKey(normalized);
      setDraftKey(normalized);
      setMailboxId(payload.mailbox_id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể kết nối.");
    } finally {
      setBusy(false);
    }
  }, []);

  const refreshFiles = useCallback(async () => {
    if (!key) return;
    const response = await fetch("/api/transfer/files", {
      headers: { "x-transfer-key": key },
      cache: "no-store",
    });
    const payload = await response.json();
    if (response.ok) setFiles(payload.files ?? []);
  }, [key]);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) void connect(saved);
  }, [connect]);

  useEffect(() => {
    if (!key) return;
    void refreshFiles();
    const timer = window.setInterval(() => void refreshFiles(), 5_000);
    return () => window.clearInterval(timer);
  }, [key, refreshFiles]);

  async function chooseFile(file: TransferFileRecord) {
    setMessage("");
    const response = await fetch(`/api/transfer/files/${encodeURIComponent(file.id)}`, {
      headers: { "x-transfer-key": key },
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error || "Không mở được file.");
      return;
    }
    setSelected(payload);
    window.setTimeout(() => document.getElementById("transfer-reader")?.scrollIntoView({ behavior: "smooth" }), 30);
  }

  async function uploadFile(file: File) {
    if (!key || !mailboxId) return;
    if (file.size > 50_000_000) {
      setMessage("File vượt giới hạn 50 MB.");
      return;
    }
    const fileId = crypto.randomUUID();
    const safeName = file.name.replace(/[\\/\u0000-\u001f\u007f]+/g, "-").slice(0, 140) || "tai-lieu";
    const pathname = `transfers/${mailboxId}/${fileId}/source/${safeName}`;
    setBusy(true);
    setMessage("");
    setUploadProgress(0);
    try {
      await upload(pathname, file, {
        access: "private",
        handleUploadUrl: "/api/transfer/upload",
        clientPayload: JSON.stringify({
          key,
          mailboxId,
          fileId,
          name: safeName,
          size: file.size,
          contentType: file.type || "application/octet-stream",
        }),
        onUploadProgress: ({ percentage }) => setUploadProgress(Math.round(percentage)),
      });
      setMessage("Đã gửi file. Hệ thống đang chuyển thành nội dung có thể nghe.");
      await refreshFiles();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể gửi file.");
    } finally {
      setBusy(false);
    }
  }

  function stopSpeech() {
    speechSessionRef.current += 1;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }

  function speakFrom(index = 0) {
    if (!blocks.length || !("speechSynthesis" in window)) return;
    stopSpeech();
    const session = speechSessionRef.current;
    const speakNext = (position: number) => {
      const block = blocks[position];
      if (!block || session !== speechSessionRef.current) {
        setSpeaking(false);
        return;
      }
      speechIndexRef.current = position;
      const utterance = new SpeechSynthesisUtterance(block.text);
      utterance.lang = "vi-VN";
      utterance.rate = 1;
      utterance.onstart = () => {
        if (session !== speechSessionRef.current) return;
        setSpeaking(true);
        document.getElementById(`transfer-block-${position}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      };
      utterance.onend = () => speakNext(position + 1);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    };
    speakNext(index);
  }

  async function removeFile(file: TransferFileRecord) {
    if (!confirm(`Xóa “${file.name}” khỏi các thiết bị đã kết nối?`)) return;
    await fetch(`/api/transfer/files?id=${encodeURIComponent(file.id)}`, {
      method: "DELETE",
      headers: { "x-transfer-key": key },
    });
    if (selected?.meta.id === file.id) setSelected(null);
    await refreshFiles();
  }

  function disconnect() {
    stopSpeech();
    localStorage.removeItem(STORAGE_KEY);
    setKey("");
    setMailboxId("");
    setFiles([]);
    setSelected(null);
    setDraftKey("");
  }

  return (
    <main className="transferShell">
      <header className="topbar">
        <a className="brand" href="/">Thuế<span>.</span></a>
        <a className="transferBack" href="/">Về trang tra cứu</a>
      </header>

      <section className="transferHero">
        <p className="eyebrow">Kết nối thiết bị một lần</p>
        <h1>Gửi file sang điện thoại.<br />Mở ra là nghe được.</h1>
        <p>Mã kết nối được lưu trên từng trình duyệt. Laptop và điện thoại dùng cùng một mã sẽ tự thấy chung danh sách file ở những lần sau.</p>
      </section>

      {!key ? (
        <section className="pairPanel">
          <div>
            <h2>Trên điện thoại</h2>
            <p>Tạo mã mới, sau đó nhập cùng mã này trên laptop.</p>
            <button type="button" onClick={() => { const next = generateKey(); setDraftKey(next); void connect(next); }} disabled={busy}>Tạo mã kết nối</button>
          </div>
          <div>
            <h2>Trên laptop</h2>
            <p>Nhập mã đã hiện trên điện thoại. Mã sẽ được nhớ cho lần sau.</p>
            <form onSubmit={(event) => { event.preventDefault(); void connect(draftKey); }}>
              <input value={draftKey} onChange={(event) => setDraftKey(event.target.value)} placeholder="Nhập mã kết nối" autoCapitalize="characters" />
              <button type="submit" disabled={busy}>Kết nối</button>
            </form>
          </div>
        </section>
      ) : (
        <>
          <section className="connectionBar">
            <div><span>Đã kết nối</span><strong>{displayKey(key)}</strong></div>
            <button type="button" onClick={disconnect}>Đổi mã</button>
          </section>

          <section className="transferWorkspace">
            <label className="uploadCard">
              <input
                type="file"
                accept=".pdf,.doc,.docx,.txt,.md,.html,.htm,.rtf,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*"
                onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file); event.currentTarget.value = ""; }}
                disabled={busy}
              />
              <span className="uploadPlus">＋</span>
              <strong>Chọn file từ thiết bị này</strong>
              <small>PDF, Word, TXT, Markdown, HTML · tối đa 50 MB</small>
              {busy && uploadProgress ? <em>Đang tải {uploadProgress}%</em> : null}
            </label>

            <div className="transferList">
              <div className="transferListHeading"><h2>File đã chuyển</h2><button type="button" onClick={() => void refreshFiles()}>Làm mới</button></div>
              {!files.length ? <p className="transferEmpty">Chưa có file nào trong hộp này.</p> : files.map((file) => (
                <article className="transferFile" key={file.id}>
                  <button type="button" className="transferFileOpen" onClick={() => void chooseFile(file)} disabled={!file.textPathname}>
                    <strong>{file.name}</strong>
                    <span>{formatSize(file.size)} · {statusText(file)}</span>
                  </button>
                  <button type="button" className="transferDelete" onClick={() => void removeFile(file)} aria-label={`Xóa ${file.name}`}>×</button>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      {message ? <p className="transferMessage" role="status">{message}</p> : null}

      {selected ? (
        <section className="transferReader" id="transfer-reader">
          <header>
            <div><p className="sectionLabel">Nội dung đã chuyển đổi</p><h2>{selected.meta.name}</h2></div>
            <button type="button" onClick={speaking ? stopSpeech : () => speakFrom(speechIndexRef.current)}>{speaking ? "Dừng nghe" : "Nghe từ đây"}</button>
          </header>
          {selected.meta.warnings.length ? <div className="answerWarnings">{selected.meta.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
          <div className="transferReaderText">
            {blocks.map((block, index) => (
              <button id={`transfer-block-${index}`} type="button" key={`${index}-${block.text.slice(0, 20)}`} onClick={() => speakFrom(index)}>{block.text}</button>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
