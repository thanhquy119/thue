"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cleanOcrSpeechText,
  formatOcrTableRow,
  splitOcrSpeechChunks,
  type OcrSpeechMode,
} from "@/lib/legal/ocr-speech";

const SPEECH_START_EVENT = "ocr-main-speech-start";

type ReadableUnit = {
  id: string;
  page: number;
  texts: string[];
};

type QueueItem = {
  unitIndex: number;
  unitId: string;
  page: number;
  chunkIndex: number;
  text: string;
};

type ReaderStatus = "idle" | "speaking" | "paused";

type CurrentPosition = {
  unitIndex: number;
  unitId: string;
  page: number;
  chunkIndex: number;
};

function nodeText(node: Element | null) {
  const supplied = node instanceof HTMLElement ? node.dataset.speechText : "";
  const text = supplied || node?.textContent || "";
  return cleanOcrSpeechText(text);
}

function tableRowText(row: HTMLElement, mode: OcrSpeechMode) {
  const table = row.closest("table");
  if (!table) return nodeText(row);
  const headerRows = Array.from(table.querySelectorAll("thead tr"));
  const lastHeader = headerRows[headerRows.length - 1];
  const headers = lastHeader
    ? Array.from(lastHeader.querySelectorAll("th,td")).map((cell) => nodeText(cell))
    : [];
  const cells = Array.from(row.querySelectorAll(":scope > th, :scope > td")).map((cell) => nodeText(cell));
  return formatOcrTableRow(headers, cells, mode);
}

function collectReadableUnits(mode: OcrSpeechMode): ReadableUnit[] {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(
    ".ocrMainPreview .ocrSpeechUnit[data-speech-id]",
  ));
  const seen = new Set<string>();
  const output: ReadableUnit[] = [];

  for (const node of nodes) {
    const id = node.dataset.speechId?.trim() ?? "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const page = Math.max(1, Number(node.dataset.page ?? 1));
    const source = node.dataset.speechKind === "table-row" ? tableRowText(node, mode) : nodeText(node);
    const cleaned = node.dataset.speechKind === "heading"
      ? source.replace(/^\d{1,3}\s*[.)]\s*/u, "").trim()
      : source;
    const texts = splitOcrSpeechChunks(cleaned);
    if (texts.length) output.push({ id, page, texts });
  }
  return output;
}

function buildQueue(units: ReadableUnit[], startUnitIndex = 0) {
  return units.slice(startUnitIndex).flatMap((unit, relativeIndex) => unit.texts.map((text, chunkIndex) => ({
    unitIndex: startUnitIndex + relativeIndex,
    unitId: unit.id,
    page: unit.page,
    chunkIndex,
    text,
  })));
}

function voiceRank(voice: SpeechSynthesisVoice) {
  const name = voice.name.toLocaleLowerCase("vi");
  if (/hoài|hoai|linh|mai|my\b|thảo|thao|female|woman|nữ/u.test(name)) return 0;
  if (/google.*việt|microsoft.*vietnam|vietnamese/u.test(name)) return 1;
  return voice.localService ? 2 : 3;
}

function statusLabel(status: ReaderStatus, current: CurrentPosition | null, total: number) {
  if (status === "paused") return `Đang tạm dừng${current ? ` ở trang ${current.page}` : ""}.`;
  if (status === "speaking" && current) return `Đang đọc trang ${current.page} · mục ${current.unitIndex + 1}/${total}.`;
  if (current) return `Đã dừng ở trang ${current.page} · chạm Tiếp tục hoặc chọn vị trí khác.`;
  return "Chạm trực tiếp vào một đoạn hoặc hàng bảng để đọc từ đó.";
}

export default function OcrMainSpeechReader() {
  const [units, setUnits] = useState<ReadableUnit[]>([]);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceUri, setVoiceUri] = useState("");
  const [speed, setSpeed] = useState(1);
  const [mode, setMode] = useState<OcrSpeechMode>("content");
  const [status, setStatus] = useState<ReaderStatus>("idle");
  const [current, setCurrent] = useState<CurrentPosition | null>(null);
  const [supported, setSupported] = useState(true);

  const unitsRef = useRef<ReadableUnit[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  const cursorRef = useRef(0);
  const sessionRef = useRef(0);
  const speakNextRef = useRef<() => void>(() => undefined);
  const signatureRef = useRef("");

  useEffect(() => {
    unitsRef.current = units;
  }, [units]);

  const clearHighlight = useCallback(() => {
    document.querySelectorAll<HTMLElement>(".ocrMainPreview .isSpeechActive").forEach((node) => {
      node.classList.remove("isSpeechActive");
    });
  }, []);

  const highlightUnit = useCallback((id: string) => {
    clearHighlight();
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, "\\$&");
    const node = document.querySelector<HTMLElement>(`.ocrMainPreview [data-speech-id="${escaped}"]`);
    node?.classList.add("isSpeechActive");
    node?.closest<HTMLElement>(".ocrMainProvision")?.classList.add("isSpeechActive");
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [clearHighlight]);

  const hardReset = useCallback(() => {
    sessionRef.current += 1;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    queueRef.current = [];
    cursorRef.current = 0;
    setStatus("idle");
    setCurrent(null);
    clearHighlight();
  }, [clearHighlight]);

  const stop = useCallback(() => {
    sessionRef.current += 1;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setStatus("idle");
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
        const nextUnits = collectReadableUnits(mode);
        const signature = nextUnits.map((unit) => `${unit.id}:${unit.page}:${unit.texts.join("¦")}`).join("¶");
        if (signature === signatureRef.current) return;
        signatureRef.current = signature;
        hardReset();
        setUnits(nextUnits);
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
  }, [hardReset, mode]);

  useEffect(() => () => hardReset(), [hardReset]);

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
      setCurrent({
        unitIndex: item.unitIndex,
        unitId: item.unitId,
        page: item.page,
        chunkIndex: item.chunkIndex,
      });
      highlightUnit(item.unitId);
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
  }, [clearHighlight, highlightUnit, speed, voiceUri, voices]);

  useEffect(() => {
    speakNextRef.current = speakNext;
  }, [speakNext]);

  const startQueue = useCallback((queue: QueueItem[]) => {
    if (!("speechSynthesis" in window) || !queue.length) return;
    sessionRef.current += 1;
    window.speechSynthesis.cancel();
    queueRef.current = queue;
    cursorRef.current = 0;
    setStatus("speaking");
    window.setTimeout(() => speakNextRef.current(), 20);
  }, []);

  const startFromUnitIndex = useCallback((unitIndex: number) => {
    const safeIndex = Math.max(0, Math.min(unitsRef.current.length - 1, unitIndex));
    startQueue(buildQueue(unitsRef.current, safeIndex));
  }, [startQueue]);

  const startFromId = useCallback((id: string) => {
    const index = unitsRef.current.findIndex((unit) => unit.id === id);
    if (index >= 0) startFromUnitIndex(index);
  }, [startFromUnitIndex]);

  useEffect(() => {
    const handleStart = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: unknown }>).detail;
      if (typeof detail?.id === "string") startFromId(detail.id);
    };
    window.addEventListener(SPEECH_START_EVENT, handleStart);
    return () => window.removeEventListener(SPEECH_START_EVENT, handleStart);
  }, [startFromId]);

  const startAll = useCallback(() => startFromUnitIndex(0), [startFromUnitIndex]);

  const resume = useCallback(() => {
    if (status === "paused") {
      window.speechSynthesis.resume();
      setStatus("speaking");
      return;
    }
    if (current) startFromUnitIndex(current.unitIndex);
    else startAll();
  }, [current, startAll, startFromUnitIndex, status]);

  const primaryAction = useCallback(() => {
    if (status === "speaking" || status === "paused") stop();
    else resume();
  }, [resume, status, stop]);

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

  const moveUnit = useCallback((offset: number) => {
    const base = current?.unitIndex ?? 0;
    startFromUnitIndex(base + offset);
  }, [current, startFromUnitIndex]);

  const statusText = useMemo(() => statusLabel(status, current, units.length), [current, status, units.length]);
  if (!units.length) return null;

  return (
    <section className="ocrSpeechDock" aria-label="Trình đọc bản OCR" aria-live="polite">
      <div className="ocrSpeechSummary">
        <span className={`ocrSpeechPulse ${status === "speaking" ? "isActive" : ""}`} aria-hidden="true"><i /><i /><i /></span>
        <div><strong>Đọc bản OCR</strong><span>{supported ? statusText : "Trình duyệt này chưa hỗ trợ đọc văn bản."}</span></div>
      </div>
      <div className="ocrSpeechTransport">
        <button type="button" onClick={() => moveUnit(-1)} disabled={!supported || !current || current.unitIndex === 0}>← Mục</button>
        <button className="ocrSpeechPrimary" type="button" onClick={primaryAction} disabled={!supported}>
          {status === "speaking" || status === "paused" ? "Dừng" : current ? "Tiếp tục" : "▶ Nghe từ đầu"}
        </button>
        <button type="button" onClick={() => moveUnit(1)} disabled={!supported || !current || current.unitIndex >= units.length - 1}>Mục →</button>
        <button type="button" onClick={startAll} disabled={!supported}>Về đầu</button>
        <button type="button" onClick={togglePause} disabled={!supported || status === "idle"}>{status === "paused" ? "Tiếp tục" : "Tạm dừng"}</button>
      </div>
      <div className="ocrSpeechSettings">
        <label><span>Chế độ</span><select value={mode} onChange={(event) => setMode(event.target.value as OcrSpeechMode)}><option value="content">Nội dung dễ nghe</option><option value="verify">Đối chiếu đủ ô bảng</option></select></label>
        {voices.length ? <label><span>Giọng Việt</span><select value={voiceUri} onChange={(event) => { setVoiceUri(event.target.value); window.localStorage.setItem("thue-ro-voice", event.target.value); }}>{voices.map((voice) => <option value={voice.voiceURI} key={voice.voiceURI}>{voice.name}</option>)}</select></label> : null}
        <label><span>Tốc độ</span><select value={speed} onChange={(event) => { const next = Number(event.target.value); setSpeed(next); window.localStorage.setItem("thue-ro-speed", String(next)); }}>{[0.75, 1, 1.25, 1.5].map((value) => <option value={value} key={value}>{value}×</option>)}</select></label>
      </div>
    </section>
  );
}
