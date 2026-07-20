"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadReadingStates, putReadingState, type ReadingStateRecord } from "./client-storage";
import type { TaxSearchResponse } from "@/lib/legal/types";
import { splitLegalBlocks, type LegalBlock } from "@/lib/legal/format";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type ReaderItem = {
  id: string;
  title: string;
  blocks: LegalBlock[];
};

function formatDate(value: string | null) {
  if (!value) return "Chưa xác định";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function normalizeCacheKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/\s+/g, " ")
    .trim();
}

function freshReadingState(documentId: string): ReadingStateRecord {
  return {
    documentId,
    bookmarked: false,
    progress: { provisionId: null, blockIndex: 0 },
    updatedAt: new Date().toISOString(),
  };
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<TaxSearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [readingStates, setReadingStates] = useState<ReadingStateRecord[]>([]);

  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [showInstall, setShowInstall] = useState(false);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceUri, setVoiceUri] = useState("");
  const [speed, setSpeed] = useState(1);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioVisible, setAudioVisible] = useState(false);
  const [audioPosition, setAudioPosition] = useState({ provisionIndex: 0, blockIndex: 0 });

  const resultRef = useRef<TaxSearchResponse | null>(null);
  const readerItemsRef = useRef<ReaderItem[]>([]);
  const readingStatesRef = useRef<ReadingStateRecord[]>([]);
  const speakAtRef = useRef<(provisionIndex: number, blockIndex: number, cancelFirst?: boolean) => void>(() => {});
  const speechSessionRef = useRef(0);

  const detail = result?.document ?? null;
  const candidates = result?.candidates ?? [];

  useEffect(() => {
    loadReadingStates()
      .then((stored) => {
        setReadingStates(stored);
        readingStatesRef.current = stored;
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", beforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", beforeInstall);
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const loadVoices = () => {
      const vietnamese = window.speechSynthesis
        .getVoices()
        .filter((voice) => voice.lang.toLocaleLowerCase("en").startsWith("vi"));
      setVoices(vietnamese);
      const saved = window.localStorage.getItem("thue-ro-voice");
      const selected = vietnamese.find((voice) => voice.voiceURI === saved) ?? vietnamese[0];
      if (selected) setVoiceUri(selected.voiceURI);
    };
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  useEffect(() => {
    resultRef.current = result;
  }, [result]);

  const stateByDocument = useMemo(
    () => new Map(readingStates.map((record) => [record.documentId, record])),
    [readingStates],
  );

  const readerItems = useMemo<ReaderItem[]>(() => {
    if (!detail) return [];
    const items = detail.provisions
      .map((provision) => {
        const blocks = splitLegalBlocks(provision.official_text);
        if (!blocks.length) return null;
        const title =
          [provision.identifier, provision.heading].filter(Boolean).join(" — ") ||
          (provision.type === "preamble" ? "Phần mở đầu" : "Nội dung văn bản");
        return { id: provision.id, title, blocks };
      })
      .filter((item): item is ReaderItem => Boolean(item));

    if (items.length) return items;
    const blocks = splitLegalBlocks(detail.official_text);
    return blocks.length ? [{ id: `${detail.id}-full`, title: "Nội dung văn bản", blocks }] : [];
  }, [detail]);

  useEffect(() => {
    readerItemsRef.current = readerItems;
  }, [readerItems]);

  const updateReadingState = useCallback(
    (documentId: string, update: (current: ReadingStateRecord) => ReadingStateRecord) => {
      setReadingStates((current) => {
        const existing = current.find((record) => record.documentId === documentId) ?? freshReadingState(documentId);
        const nextRecord = { ...update(existing), updatedAt: new Date().toISOString() };
        const next = current.some((record) => record.documentId === documentId)
          ? current.map((record) => (record.documentId === documentId ? nextRecord : record))
          : [...current, nextRecord];
        readingStatesRef.current = next;
        void putReadingState(nextRecord).catch(() => undefined);
        return next;
      });
    },
    [],
  );

  const persistProgress = useCallback(
    (provisionIndex: number, blockIndex: number) => {
      const document = resultRef.current?.document;
      const item = readerItemsRef.current[provisionIndex];
      if (!document || !item) return;
      updateReadingState(document.id, (record) => ({
        ...record,
        progress: { provisionId: item.id, blockIndex },
      }));
    },
    [updateReadingState],
  );

  const speakAt = useCallback(
    (provisionIndex: number, blockIndex: number, cancelFirst = true) => {
      if (!("speechSynthesis" in window)) return;
      const items = readerItemsRef.current;
      const item = items[provisionIndex];
      const block = item?.blocks[blockIndex];
      if (!item || !block) return;

      if (cancelFirst) {
        speechSessionRef.current += 1;
        window.speechSynthesis.cancel();
      }
      const session = speechSessionRef.current;
      const utterance = new SpeechSynthesisUtterance(block.text);
      utterance.lang = "vi-VN";
      utterance.rate = speed;
      const selectedVoice = voices.find((voice) => voice.voiceURI === voiceUri) ?? voices[0];
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.onstart = () => {
        if (session !== speechSessionRef.current) return;
        setAudioVisible(true);
        setIsSpeaking(true);
        setAudioPosition({ provisionIndex, blockIndex });
        persistProgress(provisionIndex, blockIndex);
        document.getElementById(`legal-block-${provisionIndex}-${blockIndex}`)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      };
      utterance.onend = () => {
        if (session !== speechSessionRef.current) return;
        const nextBlock = blockIndex + 1;
        if (nextBlock < item.blocks.length) {
          speakAtRef.current(provisionIndex, nextBlock, false);
        } else if (provisionIndex + 1 < items.length) {
          speakAtRef.current(provisionIndex + 1, 0, false);
        } else {
          setIsSpeaking(false);
        }
      };
      utterance.onerror = () => {
        if (session === speechSessionRef.current) setIsSpeaking(false);
      };
      window.speechSynthesis.speak(utterance);
    },
    [persistProgress, speed, voiceUri, voices],
  );

  useEffect(() => {
    speakAtRef.current = speakAt;
  }, [speakAt]);

  const startOrResume = useCallback(() => {
    if (!detail || !readerItems.length) return;
    const stored = stateByDocument.get(detail.id);
    const provisionIndex = stored?.progress.provisionId
      ? Math.max(0, readerItems.findIndex((item) => item.id === stored.progress.provisionId))
      : 0;
    const blockIndex = Math.min(
      stored?.progress.blockIndex ?? 0,
      Math.max(0, (readerItems[provisionIndex]?.blocks.length ?? 1) - 1),
    );
    speakAt(provisionIndex, blockIndex);
  }, [detail, readerItems, speakAt, stateByDocument]);

  const stopAudio = useCallback(() => {
    speechSessionRef.current += 1;
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
    persistProgress(audioPosition.provisionIndex, audioPosition.blockIndex);
  }, [audioPosition, persistProgress]);

  const toggleBookmark = useCallback(() => {
    if (!detail) return;
    updateReadingState(detail.id, (record) => ({ ...record, bookmarked: !record.bookmarked }));
  }, [detail, updateReadingState]);

  async function runSearch(value: string) {
    const cleanValue = value.trim();
    if (cleanValue.length < 2) return;

    speechSessionRef.current += 1;
    window.speechSynthesis?.cancel();
    setAudioVisible(false);
    setIsSpeaking(false);
    setSearching(true);
    setSearchError("");
    setResult(null);

    const cacheKey = `thue-ro-search-v2:${normalizeCacheKey(cleanValue)}`;
    try {
      const cached = window.sessionStorage.getItem(cacheKey);
      if (cached) {
        const payload = JSON.parse(cached) as TaxSearchResponse;
        setResult(payload);
        window.setTimeout(() => document.getElementById("search-result")?.scrollIntoView({ behavior: "smooth" }), 30);
        return;
      }

      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: cleanValue }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Không thể tra cứu lúc này.");
      const searchPayload = payload as TaxSearchResponse;
      setResult(searchPayload);
      window.sessionStorage.setItem(cacheKey, JSON.stringify(searchPayload));
      window.setTimeout(() => document.getElementById("search-result")?.scrollIntoView({ behavior: "smooth" }), 30);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Không thể tra cứu lúc này.");
    } finally {
      setSearching(false);
    }
  }

  async function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    await runSearch(query);
  }

  function chooseCandidate(number: string) {
    setQuery(number);
    void runSearch(number);
  }

  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
      return;
    }
    setShowInstall(true);
  }

  const currentRecord = detail ? stateByDocument.get(detail.id) : null;
  const currentAudioItem = readerItems[audioPosition.provisionIndex];

  return (
    <main className="siteShell" id="top">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Thuế — Trang đầu">Thuế<span>.</span></a>
        <button className="installLink" type="button" onClick={installApp}>Cài trên iPhone</button>
      </header>

      <section className={`hero ${result || searching ? "compact" : ""}`} aria-labelledby="hero-title">
        <p className="eyebrow">Tra cứu văn bản và hỏi đáp thuế</p>
        <h1 id="hero-title">Tìm đúng văn bản.<br />Đọc toàn văn.</h1>
        <form className="searchBox" onSubmit={submitSearch}>
          <span className="searchGlyph" aria-hidden="true">⌕</span>
          <label className="srOnly" htmlFor="legal-search">Câu hỏi hoặc số hiệu văn bản</label>
          <input
            id="legal-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ví dụ: Thông tư 89 hoặc hộ kinh doanh có phải nộp thuế không?"
            maxLength={500}
          />
          <button type="submit" disabled={searching}>{searching ? "Đang tìm…" : "Tra cứu"}</button>
        </form>
        {searchError ? <p className="searchError" role="alert">{searchError}</p> : null}
      </section>

      {searching ? (
        <section className="loadingPanel" aria-live="polite">
          <div className="loadingDot" />
          <div><strong>Đang tìm nguồn chính thức và tải toàn văn…</strong><p>Lần đầu có thể mất khoảng 10–30 giây; các lần sau sẽ nhanh hơn nhờ cache.</p></div>
        </section>
      ) : null}

      {result ? (
        <section className="resultShell" id="search-result">
          {result.query_kind === "question" ? (
            <article className="answerPanel">
              <p className="sectionLabel">Trả lời theo văn bản chính thức</p>
              <div className="directAnswer">{result.direct_answer}</div>
              <div className="answerMeta"><span>Độ tin cậy {Math.round(result.confidence * 100)}%</span></div>
            </article>
          ) : null}

          {candidates.length ? (
            <article className="candidatePanel">
              <p className="sectionLabel">{detail ? "Văn bản liên quan" : "Chọn đúng văn bản"}</p>
              <h2>{detail ? "Các văn bản khác có liên quan đến câu hỏi" : result.direct_answer}</h2>
              <div className="candidateList">
                {candidates.map((candidate) => (
                  <button className="candidateCard" type="button" key={candidate.id} onClick={() => chooseCandidate(candidate.number)}>
                    <span className="candidateType">{candidate.type}</span>
                    <strong>{candidate.number}</strong>
                    <span className="candidateTitle">{candidate.title}</span>
                    <span className="candidateMeta">{candidate.issuer} · {formatDate(candidate.issued_date)}</span>
                    <span className="candidateAction">Mở toàn văn →</span>
                  </button>
                ))}
              </div>
            </article>
          ) : null}

          {result.document ? (
            <article className="documentDetail">
              <header className="detailHeader">
                <button className={`saveButton ${currentRecord?.bookmarked ? "saved" : ""}`} type="button" onClick={toggleBookmark}>
                  {currentRecord?.bookmarked ? "✓ Đã lưu" : "＋ Lưu"}
                </button>
                <div className="detailBadges"><span>{result.document.type}</span><span>{result.document.status === "effective" ? "Đang hiệu lực" : result.document.status === "upcoming" ? "Sắp hiệu lực" : "Chưa xác định hiệu lực"}</span></div>
                <p className="documentKicker">{result.document.number}</p>
                <h2>{result.document.title}</h2>
                <dl className="facts">
                  <div><dt>Cơ quan ban hành</dt><dd>{result.document.issuer}</dd></div>
                  <div><dt>Ngày ban hành</dt><dd>{formatDate(result.document.issued_date)}</dd></div>
                  <div><dt>Ngày hiệu lực</dt><dd>{formatDate(result.document.effective_date)}</dd></div>
                </dl>
                <div className="headerActions">
                  <button className="listenButton" type="button" onClick={startOrResume} disabled={!readerItems.length}><span>▶</span>{currentRecord?.progress.provisionId ? "Nghe tiếp" : "Nghe từ đầu"}</button>
                  <a className="sourceLink" href={result.document.source_url} target="_blank" rel="noreferrer">Mở nguồn chính thức ↗</a>
                </div>
              </header>

              <section className="readerBlock">
                <div className="readerHeading">
                  <div><p className="sectionLabel">Nguyên văn chính thức</p><h3>Toàn bộ nội dung văn bản</h3></div>
                </div>
                <div className="readerText">
                  {readerItems.map((item, provisionIndex) => (
                    <section className="legalProvision" key={item.id} id={`provision-${item.id}`}>
                      <h4><span>{String(provisionIndex + 1).padStart(2, "0")}.</span>{item.title}</h4>
                      <div className="legalBlocks">
                        {item.blocks.map((block, blockIndex) => {
                          const speaking = audioVisible && audioPosition.provisionIndex === provisionIndex && audioPosition.blockIndex === blockIndex;
                          return (
                            <button
                              id={`legal-block-${provisionIndex}-${blockIndex}`}
                              className={`legalBlock ${block.kind} ${speaking ? "speaking" : ""}`}
                              type="button"
                              key={`${item.id}-${blockIndex}`}
                              onClick={() => speakAt(provisionIndex, blockIndex)}
                            >
                              {block.text}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
                {result.document.verification_notes ? <p className="verificationNote">{result.document.verification_notes}</p> : null}
              </section>
            </article>
          ) : candidates.length ? null : (
            <article className="emptyResult">
              <h2>Chưa thể hiển thị toàn văn</h2>
              <p>{result.direct_answer}</p>
            </article>
          )}

          {result.warnings.length ? (
            <div className="answerWarnings">{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
          ) : null}
        </section>
      ) : null}

      {!result && !searching ? (
        <section className="homeHint">
          <p>Có thể nhập số hiệu đầy đủ, số hiệu rút gọn như “Thông tư 89”, hoặc đặt câu hỏi nghiệp vụ thuế bằng ngôn ngữ tự nhiên.</p>
        </section>
      ) : null}

      <footer><a className="brand" href="#top">Thuế<span>.</span></a><span>Không dùng cơ sở dữ liệu văn bản cố định; toàn văn được lấy từ nguồn chính thức và lưu cache.</span></footer>

      <div className={`audioDock ${audioVisible ? "visible" : ""}`} aria-label="Trình đọc văn bản">
        <div className="audioTitle"><span className="equalizer" aria-hidden="true"><i /><i /><i /></span><div><strong>{detail?.number}</strong><span>{currentAudioItem?.title}</span></div></div>
        <div className="audioTransport">
          <button type="button" onClick={() => speakAt(Math.max(0, audioPosition.provisionIndex - 1), 0)}>← Điều</button>
          <button className="stopButton" type="button" onClick={isSpeaking ? stopAudio : () => speakAt(audioPosition.provisionIndex, audioPosition.blockIndex)}>{isSpeaking ? "Dừng" : "Tiếp tục"}</button>
          <button type="button" onClick={() => speakAt(Math.min(readerItems.length - 1, audioPosition.provisionIndex + 1), 0)}>Điều →</button>
        </div>
        <div className="audioSettings">
          {voices.length ? (
            <label><span>Giọng</span><select value={voiceUri} onChange={(event) => { setVoiceUri(event.target.value); window.localStorage.setItem("thue-ro-voice", event.target.value); }}>{voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>)}</select></label>
          ) : null}
          <label><span>Tốc độ</span><select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>{[0.75, 1, 1.25, 1.5].map((value) => <option key={value} value={value}>{value}×</option>)}</select></label>
        </div>
      </div>

      {showInstall ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={() => setShowInstall(false)}>
          <section className="installSheet" onClick={(event) => event.stopPropagation()}>
            <span className="sheetHandle" /><button className="closeButton" type="button" onClick={() => setShowInstall(false)} aria-label="Đóng">×</button>
            <div className="appIcon">T</div><p className="eyebrow">Thêm vào màn hình chính</p><h2 id="install-title">Cài Thuế trên iPhone</h2>
            <ol><li><span>1</span><p>Mở trang bằng Safari.</p></li><li><span>2</span><p>Chạm nút Chia sẻ.</p></li><li><span>3</span><p>Chọn “Thêm vào MH chính”.</p></li></ol>
            <button className="sheetDone" type="button" onClick={() => setShowInstall(false)}>Đã hiểu</button>
          </section>
        </div>
      ) : null}
    </main>
  );
}
