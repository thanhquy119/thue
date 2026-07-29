"use client";

import { upload } from "@vercel/blob/client";
import { QRCodeSVG } from "qrcode.react";
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

function formatTransferredAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Chưa xác định";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function fileFormat(file: TransferFileRecord) {
  const extension = file.name.toLocaleLowerCase("en").match(/\.([a-z0-9]{1,8})$/u)?.[1];
  return extension?.toLocaleUpperCase("en") || "TÀI LIỆU";
}

function extractionLabel(method: string | null) {
  switch (method) {
    case "docx":
      return "Trích từ Word";
    case "doc":
      return "Trích từ Word cũ";
    case "pdf_text":
      return "Lớp chữ PDF";
    case "pdf_ocr":
    case "ocr":
      return "OCR PDF scan";
    case "html":
      return "Trích từ HTML";
    case "plain_text":
      return "Văn bản thuần";
    default:
      return "Đã chuyển đổi";
  }
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
  const [origin, setOrigin] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [files, setFiles] = useState<TransferFileRecord[]>([]);
  const [selected, setSelected] = useState<{ meta: TransferFileRecord; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceUri, setVoiceUri] = useState("");
  const [speed, setSpeed] = useState(1);
  const [speaking, setSpeaking] = useState(false);
  const [audioVisible, setAudioVisible] = useState(false);
  const [speechIndex, setSpeechIndex] = useState(0);
  const speechIndexRef = useRef(0);
  const speechSessionRef = useRef(0);

  const blocks = useMemo(() => selected ? splitLegalBlocks(selected.text) : [], [selected]);
  const pairUrl = useMemo(
    () => key && origin ? `${origin}/transfer#pair=${encodeURIComponent(key)}` : "",
    [key, origin],
  );

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
    setOrigin(window.location.origin);
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const pairingKey = fragment.get("pair");
    if (pairingKey) {
      window.history.replaceState({}, "", window.location.pathname);
      setShowQr(false);
      void connect(pairingKey);
      return;
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) void connect(saved);
  }, [connect]);

  useEffect(() => {
    if (!key) return;
    void refreshFiles();
    const timer = window.setInterval(() => void refreshFiles(), 5_000);
    return () => window.clearInterval(timer);
  }, [key, refreshFiles]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const loadVoices = () => {
      const vietnamese = window.speechSynthesis
        .getVoices()
        .filter((voice) => voice.lang.toLocaleLowerCase("en").startsWith("vi"));
      setVoices(vietnamese);
      const saved = window.localStorage.getItem("thue-ro-voice");
      const nextVoice = vietnamese.find((voice) => voice.voiceURI === saved) ?? vietnamese[0];
      if (nextVoice) setVoiceUri(nextVoice.voiceURI);
    };
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  async function chooseFile(file: TransferFileRecord) {
    setMessage("");
    stopSpeech(true);
    const response = await fetch(`/api/transfer/files/${encodeURIComponent(file.id)}`, {
      headers: { "x-transfer-key": key },
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error || "Không mở được file.");
      return;
    }
    speechIndexRef.current = 0;
    setSpeechIndex(0);
    setAudioVisible(false);
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

  function stopSpeech(hideDock = false) {
    speechSessionRef.current += 1;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    if (hideDock) setAudioVisible(false);
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
      setSpeechIndex(position);
      const utterance = new SpeechSynthesisUtterance(block.text);
      utterance.lang = "vi-VN";
      utterance.rate = speed;
      const selectedVoice = voices.find((voice) => voice.voiceURI === voiceUri) ?? voices[0];
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.onstart = () => {
        if (session !== speechSessionRef.current) return;
        setAudioVisible(true);
        setSpeaking(true);
        document.getElementById(`transfer-block-${position}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      };
      utterance.onend = () => speakNext(position + 1);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    };
    speakNext(Math.max(0, Math.min(index, blocks.length - 1)));
  }

  async function removeFile(file: TransferFileRecord) {
    if (!confirm(`Xóa “${file.name}” khỏi các thiết bị đã kết nối?`)) return;
    await fetch(`/api/transfer/files?id=${encodeURIComponent(file.id)}`, {
      method: "DELETE",
      headers: { "x-transfer-key": key },
    });
    if (selected?.meta.id === file.id) {
      stopSpeech(true);
      setSelected(null);
    }
    await refreshFiles();
  }

  function disconnect() {
    stopSpeech(true);
    localStorage.removeItem(STORAGE_KEY);
    setKey("");
    setMailboxId("");
    setFiles([]);
    setSelected(null);
    setDraftKey("");
    setShowQr(false);
  }

  async function copyPairLink() {
    if (!pairUrl) return;
    try {
      await navigator.clipboard.writeText(pairUrl);
      setMessage("Đã sao chép liên kết kết nối.");
    } catch {
      setMessage("Không thể sao chép tự động. Có thể dùng mã kết nối bên dưới.");
    }
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
      </section>

      {!key ? (
        <section className="pairPanel">
          <div>
            <h2>Tạo kết nối mới</h2>
            <p>Tạo hộp file và hiện mã QR để thiết bị còn lại quét.</p>
            <button
              type="button"
              onClick={() => {
                const next = generateKey();
                setShowQr(true);
                void connect(next);
              }}
              disabled={busy}
            >
              Tạo mã QR kết nối
            </button>
          </div>
          <div>
            <h2>Nhập mã dự phòng</h2>
            <p>Dùng khi thiết bị không quét được QR.</p>
            <form onSubmit={(event) => { event.preventDefault(); setShowQr(false); void connect(draftKey); }}>
              <input value={draftKey} onChange={(event) => setDraftKey(event.target.value)} placeholder="Nhập mã kết nối" autoCapitalize="characters" />
              <button type="submit" disabled={busy}>Kết nối</button>
            </form>
          </div>
        </section>
      ) : (
        <>
          <section className="connectionBar">
            <div><span>Đã kết nối</span><strong>{displayKey(key)}</strong></div>
            <div className="connectionActions">
              <button type="button" onClick={() => setShowQr((current) => !current)}>{showQr ? "Ẩn QR" : "Kết nối thiết bị khác"}</button>
              <button className="secondaryAction" type="button" onClick={disconnect}>Đổi mã</button>
            </div>
          </section>

          {showQr && pairUrl ? (
            <section className="pairQrPanel" aria-labelledby="pair-qr-title">
              <div className="pairQrCopy">
                <p className="sectionLabel">Kết nối nhanh</p>
                <h2 id="pair-qr-title">Quét mã này bằng thiết bị còn lại</h2>
                <p>Mở Camera, quét QR rồi chạm vào liên kết. Thiết bị mới sẽ tự kết nối và ghi nhớ hộp file này.</p>
                <button type="button" onClick={() => void copyPairLink()}>Sao chép liên kết</button>
              </div>
              <div className="pairQrCode">
                <QRCodeSVG
                  value={pairUrl}
                  size={224}
                  level="M"
                  title="Mã QR kết nối hộp file Thuế"
                />
              </div>
            </section>
          ) : null}

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
        <section className="resultShell transferResultShell" id="transfer-reader">
          <article className="documentDetail transferDocumentDetail">
            <header className="detailHeader">
              <div className="detailBadges">
                <span>{fileFormat(selected.meta)}</span>
                <span>{statusText(selected.meta)}</span>
              </div>
              <p className="documentKicker">Tài liệu cá nhân</p>
              <h2>{selected.meta.name}</h2>
              <dl className="facts">
                <div><dt>Định dạng</dt><dd>{fileFormat(selected.meta)}</dd></div>
                <div><dt>Dung lượng</dt><dd>{formatSize(selected.meta.size)}</dd></div>
                <div><dt>Ngày chuyển</dt><dd>{formatTransferredAt(selected.meta.createdAt)}</dd></div>
              </dl>
              <div className="headerActions">
                <button className="listenButton" type="button" onClick={() => speakFrom(speechIndexRef.current)} disabled={!blocks.length}>
                  <span>▶</span>{audioVisible ? "Nghe tiếp" : "Nghe từ đầu"}
                </button>
                <span className="transferMethod">{extractionLabel(selected.meta.extractionMethod)}</span>
              </div>
              {selected.meta.warnings.length ? (
                <div className="answerWarnings transferWarnings">
                  {selected.meta.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                </div>
              ) : null}
            </header>

            <section className="readerBlock">
              <div className="readerHeading">
                <div><p className="sectionLabel">Nội dung đã chuyển đổi</p><h3>Toàn bộ nội dung tài liệu</h3></div>
              </div>
              <div className="readerText">
                <section className="legalProvision">
                  <h4><span>01.</span>Nội dung tài liệu</h4>
                  <div className="legalBlocks">
                    {blocks.map((block, index) => (
                      <button
                        id={`transfer-block-${index}`}
                        className={`legalBlock ${block.kind} ${audioVisible && speechIndex === index ? "speaking" : ""}`}
                        type="button"
                        key={`${index}-${block.text.slice(0, 20)}`}
                        onClick={() => speakFrom(index)}
                      >
                        {block.text}
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            </section>
          </article>
        </section>
      ) : null}

      <div className={`audioDock ${audioVisible ? "visible" : ""}`} aria-label="Trình đọc tài liệu đã chuyển">
        <div className="audioTitle">
          <span className="equalizer" aria-hidden="true"><i /><i /><i /></span>
          <div><strong>{selected?.meta.name}</strong><span>Đoạn {blocks.length ? speechIndex + 1 : 0}/{blocks.length}</span></div>
        </div>
        <div className="audioTransport">
          <button type="button" onClick={() => speakFrom(Math.max(0, speechIndex - 1))}>← Đoạn</button>
          <button className="stopButton" type="button" onClick={speaking ? () => stopSpeech() : () => speakFrom(speechIndex)}>{speaking ? "Dừng" : "Tiếp tục"}</button>
          <button type="button" onClick={() => speakFrom(Math.min(Math.max(0, blocks.length - 1), speechIndex + 1))}>Đoạn →</button>
        </div>
        <div className="audioSettings">
          {voices.length ? (
            <label>
              <span>Giọng</span>
              <select
                value={voiceUri}
                onChange={(event) => {
                  setVoiceUri(event.target.value);
                  window.localStorage.setItem("thue-ro-voice", event.target.value);
                }}
              >
                {voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>)}
              </select>
            </label>
          ) : null}
          <label><span>Tốc độ</span><select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>{[0.75, 1, 1.25, 1.5].map((value) => <option key={value} value={value}>{value}×</option>)}</select></label>
        </div>
      </div>
    </main>
  );
}
