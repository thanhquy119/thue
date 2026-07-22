"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cleanOcrSpeechText,
  formatOcrTableRow,
  splitOcrSpeechChunks,
  type OcrSpeechMode,
} from "@/lib/legal/ocr-speech";

type ReadablePage = {
  page: number;
  segments: string[];
};

type QueueItem = {
  pageIndex: number;
  page: number;
  segmentIndex: number;
  text: string;
};

type ReaderStatus = "idle" | "speaking" | "paused";

function nodeText(node: Element | null) {
  return cleanOcrSpeechText(node?.textContent ?? "");
}

function extractTable(group: Element, mode: OcrSpeechMode) {
  const table = group.querySelector("table");
  if (!table) return [];
  const headerRows = Array.from(table.querySelectorAll("thead tr"));
  const lastHeader = headerRows[headerRows.length - 1];
  const headers = lastHeader
    ? Array.from(lastHeader.querySelectorAll("th,td")).map((cell) => nodeText(cell))
    : [];
  const rows = Array.from(table.querySelectorAll("tbody tr"));
  const output: string[] = [];
  if (mode === "verify") output.push("Bắt đầu bảng đối chiếu.");
  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll(":scope > th, :scope > td")).map((cell) => nodeText(cell));
    const spoken = formatOcrTableRow(headers, cells, mode);
    if (spoken) output.push(spoken);
  }
  if (mode === "verify") output.push("Kết thúc bảng đối chiếu.");
  return output;
}

function extractPage(node: HTMLElement, mode: OcrSpeechMode, fallbackPage: number): ReadablePage {
  const pageLabel = node.querySelector(".ocrPaperNumber")?.textContent ?? "";
  const parsedPage = Number(pageLabel.match(/Trang\s+(\d+)/iu)?.[1] ?? fallbackPage);
  const content = node.querySelector(".ocrPaperContent");
  const rawSegments: string[] = [`Trang ${parsedPage}.`];

  for (const child of Array.from(content?.children ?? [])) {
    if (child.classList.contains("ocrDocTableGroup") || child.classList.contains("ocrDocTableWrap")) {
      rawSegments.push(...extractTable(child, mode));
      continue;
    }
    const text = nodeText(child);
    if (text) rawSegments.push(text);
  }

  return {
    page: parsedPage,
    segments: rawSegments.flatMap((segment) => splitOcrSpeechChunks(segment)),
  };
}

function voiceRank(voice: SpeechSynthesisVoice) {
  const name = voice.name.toLocaleLowerCase("vi");
  if (/hoài|hoai|linh|mai|my\b|thảo|thao|female|woman|nữ/u.test(name)) return 0;
  if (/google.*việt|microsoft.*vietnam|vietnamese/u.test(name)) return 1;
  return voice.localService ? 2 : 3;
}

function statusLabel(status: ReaderStatus, page?: number, segmentIndex?: number) {
  if (status === "paused") return `Đang tạm dừng${page ? ` ở trang ${page}` : ""}.`;
  if (status === "speaking") return `Đang đọc${page ? ` trang ${page}` : ""}${segmentIndex !== undefined ? ` · đoạn ${segmentIndex + 1}` : ""}.`;
  return "Sẵn sàng đọc nội dung OCR.";
}

export default function OcrDomSpeechReader() {
  const [pages, setPages] = useState<ReadablePage[]>([]);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceUri, setVoiceUri] = useState("");
  const [speed, setSpeed] = useState(1);
  const [mode, setMode] = useState<OcrSpeechMode>("content");
  const [status, setStatus] = useState<ReaderStatus>("idle");
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);
  const [current, setCurrent] = useState<{ pageIndex: number; page: number; segmentIndex: number } | null>(null);
  const [supported, setSupported] = useState(true);

  const pagesRef = useRef<ReadablePage[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  const cursorRef = useRef(0);
  const sessionRef = useRef(0);
  const speakNextRef = useRef<() => void>(() => undefined);
  const signatureRef = useRef("");

  useEffect(() => {
    pagesRef.current = pages;
    if (selectedPageIndex >= pages.length) setSelectedPageIndex(Math.max(0, pages.length - 1));
  }, [pages, selectedPageIndex]);

  const clearHighlight = useCallback(() => {
    document.querySelectorAll<HTMLElement>(".ocrPaperPage.isSpeechActive").forEach((page) => {
      page.classList.remove("isSpeechActive");
    });
  }, []);

  const highlightPage = useCallback((pageIndex: number) => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(".ocrPaperPage"));
    nodes.forEach((node, index) => node.classList.toggle("isSpeechActive", index === pageIndex));
    nodes[pageIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const stop = useCallback(() => {
    sessionRef.current += 1;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    queueRef.current = [];
    cursorRef.current = 0;
    setStatus("idle");
    setCurrent(null);
    clearHighlight();
  }, [clearHighlight]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      setSupported(false);
      return;
    }
    const loadVoices = () => {
      const vietnamese = window.speechSynthesis
        .getVoices()
        .filter((voice) => voice.lang.toLocaleLowerCase("en").startsWith("vi"))
        .sort((left, right) => voiceRank(left) - voiceRank(right) || left.name.localeCompare(right.name, "vi"));
      setVoices(vietnamese);
      const saved = window.localStorage.getItem("thue-ro-voice");
      const selected = vietnamese.find((voice) => voice.voiceURI === saved) ?? vietnamese[0];
      if (selected) setVoiceUri(selected.voiceURI);
      const savedSpeed = Number(window.localStorage.getItem("thue-ro-speed"));
      if ([0.75, 1, 1.25, 1.5].includes(savedSpeed)) setSpeed(savedSpeed);
    };
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
  }, []);

  useEffect(() => {
    let frame = 0;
    const rebuild = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const nodes = Array.from(document.querySelectorAll<HTMLElement>(".ocrPaperPage"));
        const nextPages = nodes.map((node, index) => extractPage(node, mode, index + 1));
        const signature = nextPages.map((page) => `${page.page}:${page.segments.join("¦")}`).join("¶");
        if (signature === signatureRef.current) return;
        signatureRef.current = signature;
        setPages(nextPages);
      });
    };

    rebuild();
    const root = document.querySelector(".ocrLabShell") ?? document.body;
    const observer = new MutationObserver(rebuild);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [mode]);

  useEffect(() => {
    stop();
  }, [mode, stop]);

  useEffect(() => () => stop(), [stop]);

  const speakNext = useCallback(() => {
    if (!("speechSynthesis" in window)) return;
    const item = queueRef.current[cursorRef.current];
    if (!item) {
      setStatus("idle");
      setCurrent(null);
      clearHighlight();
      return;
    }

    const session = sessionRef.current;
    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.lang = "vi-VN";
    utterance.rate = speed;
    const selectedVoice = voices.find((voice) => voice.voiceURI === voiceUri) ?? voices[0];
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.onstart = () => {
      if (session !== sessionRef.current) return;
      setStatus("speaking");
      setCurrent({ pageIndex: item.pageIndex, page: item.page, segmentIndex: item.segmentIndex });
      setSelectedPageIndex(item.pageIndex);
      highlightPage(item.pageIndex);
    };
    utterance.onend = () => {
      if (session !== sessionRef.current) return;
      cursorRef.current += 1;
      window.setTimeout(() => speakNextRef.current(), 30);
    };
    utterance.onerror = (event) => {
      if (session !== sessionRef.current || event.error === "canceled" || event.error === "interrupted") return;
      setStatus("idle");
    };
    window.speechSynthesis.speak(utterance);
  }, [clearHighlight, highlightPage, speed, voiceUri, voices]);

  useEffect(() => {
    speakNextRef.current = speakNext;
  }, [speakNext]);

  const buildQueue = useCallback((pageIndexes: number[]) => {
    return pageIndexes.flatMap((pageIndex) => {
      const page = pagesRef.current[pageIndex];
      if (!page) return [];
      return page.segments.map((text, segmentIndex) => ({
        pageIndex,
        page: page.page,
        segmentIndex,
        text,
      }));
    });
  }, []);

  const startQueue = useCallback((queue: QueueItem[]) => {
    if (!("speechSynthesis" in window) || !queue.length) return;
    sessionRef.current += 1;
    window.speechSynthesis.cancel();
    queueRef.current = queue;
    cursorRef.current = 0;
    setStatus("speaking");
    window.setTimeout(() => speakNextRef.current(), 20);
  }, []);

  const startAll = useCallback(() => {
    startQueue(buildQueue(pagesRef.current.map((_, index) => index)));
  }, [buildQueue, startQueue]);

  const startSelectedPage = useCallback(() => {
    startQueue(buildQueue([selectedPageIndex]));
  }, [buildQueue, selectedPageIndex, startQueue]);

  const togglePause = useCallback(() => {
    if (!("speechSynthesis" in window)) return;
    if (status === "speaking") {
      window.speechSynthesis.pause();
      setStatus("paused");
    } else if (status === "paused") {
      window.speechSynthesis.resume();
      setStatus("speaking");
    }
  }, [status]);

  const movePage = useCallback((offset: number) => {
    const next = Math.max(0, Math.min(pagesRef.current.length - 1, selectedPageIndex + offset));
    setSelectedPageIndex(next);
    startQueue(buildQueue([next]));
  }, [buildQueue, selectedPageIndex, startQueue]);

  const selectedPage = pages[selectedPageIndex];
  const statusText = useMemo(
    () => statusLabel(status, current?.page, current?.segmentIndex),
    [current, status],
  );

  if (!pages.length) return null;

  return (
    <section className="ocrSpeechDock" aria-label="Trình đọc bản OCR" aria-live="polite">
      <div className="ocrSpeechSummary">
        <span className={`ocrSpeechPulse ${status === "speaking" ? "isActive" : ""}`} aria-hidden="true"><i /><i /><i /></span>
        <div>
          <strong>Đọc bản OCR</strong>
          <span>{supported ? statusText : "Trình duyệt này chưa hỗ trợ đọc văn bản."}</span>
        </div>
      </div>

      <div className="ocrSpeechTransport">
        <button type="button" onClick={() => movePage(-1)} disabled={!supported || selectedPageIndex === 0}>← Trang</button>
        <button className="ocrSpeechPrimary" type="button" onClick={startSelectedPage} disabled={!supported || !selectedPage}>▶ Trang {selectedPage?.page}</button>
        <button type="button" onClick={startAll} disabled={!supported}>Đọc tất cả</button>
        <button type="button" onClick={togglePause} disabled={!supported || status === "idle"}>{status === "paused" ? "Tiếp tục" : "Tạm dừng"}</button>
        <button type="button" onClick={stop} disabled={!supported || status === "idle"}>Dừng</button>
        <button type="button" onClick={() => movePage(1)} disabled={!supported || selectedPageIndex >= pages.length - 1}>Trang →</button>
      </div>

      <div className="ocrSpeechSettings">
        <label>
          <span>Trang</span>
          <select value={selectedPageIndex} onChange={(event) => setSelectedPageIndex(Number(event.target.value))}>
            {pages.map((page, index) => <option value={index} key={`${page.page}-${index}`}>Trang {page.page}</option>)}
          </select>
        </label>
        <label>
          <span>Chế độ</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as OcrSpeechMode)}>
            <option value="content">Nội dung dễ nghe</option>
            <option value="verify">Đối chiếu đủ ô bảng</option>
          </select>
        </label>
        {voices.length ? (
          <label>
            <span>Giọng Việt</span>
            <select value={voiceUri} onChange={(event) => {
              setVoiceUri(event.target.value);
              window.localStorage.setItem("thue-ro-voice", event.target.value);
            }}>
              {voices.map((voice) => <option value={voice.voiceURI} key={voice.voiceURI}>{voice.name}</option>)}
            </select>
          </label>
        ) : null}
        <label>
          <span>Tốc độ</span>
          <select value={speed} onChange={(event) => {
            const next = Number(event.target.value);
            setSpeed(next);
            window.localStorage.setItem("thue-ro-speed", String(next));
          }}>
            {[0.75, 1, 1.25, 1.5].map((value) => <option value={value} key={value}>{value}×</option>)}
          </select>
        </label>
      </div>
    </section>
  );
}
