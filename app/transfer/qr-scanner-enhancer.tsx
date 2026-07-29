"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QrCameraScanner, { type QrCameraScannerHandle } from "./qr-camera-scanner";

const STORAGE_KEY = "thue-transfer-key-v1";
const DEVICE_STORAGE_KEY = "thue-transfer-device-v1";
const PAIRING_POLL_MS = 2_000;
const TABLE_CELL_MARKER = "\uE000";
const TABLE_ROW_MARKER = "\uE001";
const TABLE_START_MARKER = "\uE002";
const TABLE_END_MARKER = "\uE003";

type DeviceKind = "unknown" | "desktop" | "mobile";
type SessionPayload = {
  error?: string;
  paired?: boolean;
  device_count?: number;
};
type TransferFileSummary = {
  id: string;
  name: string;
  contentType: string;
};
type TransferListPayload = {
  error?: string;
  files?: TransferFileSummary[];
};
type PreparedSource = {
  fileId: string;
  name: string;
  contentType: string;
  blob: Blob;
};
type StructuredSegment =
  | { kind: "text"; text: string }
  | { kind: "table"; rows: string[][] };

function detectDeviceKind(): Exclude<DeviceKind, "unknown"> {
  const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/iu.test(navigator.userAgent);
  const compactTouch = window.matchMedia?.("(pointer: coarse)").matches &&
    Math.min(window.screen.width, window.screen.height) <= 900;
  return mobileUserAgent || compactTouch ? "mobile" : "desktop";
}

function persistentDeviceId() {
  const saved = window.localStorage.getItem(DEVICE_STORAGE_KEY);
  if (saved) return saved;
  const created = crypto.randomUUID();
  window.localStorage.setItem(DEVICE_STORAGE_KEY, created);
  return created;
}

function currentTransferKey() {
  return window.localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
}

function cleanStructuredText(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function structuredSegments(value: string): StructuredSegment[] {
  const segments: StructuredSegment[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf(TABLE_START_MARKER, cursor);
    if (start < 0) {
      const text = cleanStructuredText(value.slice(cursor));
      if (text) segments.push({ kind: "text", text });
      break;
    }
    const prefix = cleanStructuredText(value.slice(cursor, start));
    if (prefix) segments.push({ kind: "text", text: prefix });
    const end = value.indexOf(TABLE_END_MARKER, start + TABLE_START_MARKER.length);
    if (end < 0) break;
    const tableText = value.slice(start + TABLE_START_MARKER.length, end);
    const rows = tableText
      .split(TABLE_ROW_MARKER)
      .map((row) => row.trim())
      .filter(Boolean)
      .map((row) => row.split(TABLE_CELL_MARKER).map(cleanStructuredText));
    if (rows.length && Math.max(...rows.map((row) => row.filter(Boolean).length)) >= 2) {
      segments.push({ kind: "table", rows });
    }
    cursor = end + TABLE_END_MARKER.length;
  }
  return segments;
}

function enhanceStructuredTables() {
  const blocks = document.querySelectorAll<HTMLButtonElement>(".transferDocumentDetail .legalBlock");
  for (const block of blocks) {
    if (block.dataset.transferTableEnhanced === "true") continue;
    const raw = block.textContent ?? "";
    if (!raw.includes(TABLE_START_MARKER) || !raw.includes(TABLE_CELL_MARKER)) continue;
    const segments = structuredSegments(raw);
    if (!segments.some((segment) => segment.kind === "table")) continue;
    block.replaceChildren();
    block.classList.add("transferTableBlock");
    block.dataset.transferTableEnhanced = "true";
    block.title = "Chạm để nghe phần nội dung bảng";
    for (const segment of segments) {
      if (segment.kind === "text") {
        const context = document.createElement("span");
        context.className = "transferTableContext";
        context.textContent = segment.text;
        block.append(context);
        continue;
      }
      const columnCount = Math.max(...segment.rows.map((row) => row.length));
      const table = document.createElement("span");
      table.className = "transferStructuredTable";
      table.setAttribute("role", "table");
      table.setAttribute("aria-rowcount", String(segment.rows.length));
      table.setAttribute("aria-colcount", String(columnCount));
      table.style.setProperty("--transfer-table-columns", String(columnCount));
      segment.rows.forEach((row, rowIndex) => {
        const rowElement = document.createElement("span");
        rowElement.className = "transferStructuredRow";
        rowElement.setAttribute("role", "row");
        for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
          const cell = document.createElement("span");
          cell.className = "transferStructuredCell";
          cell.setAttribute("role", rowIndex === 0 ? "columnheader" : "cell");
          cell.textContent = row[columnIndex] ?? "";
          rowElement.append(cell);
        }
        table.append(rowElement);
      });
      block.append(table);
    }
  }
}

function openBlobFallback(source: PreparedSource) {
  const url = URL.createObjectURL(source.blob);
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    const link = document.createElement("a");
    link.href = url;
    link.download = source.name;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function QrScannerEnhancer() {
  const scannerRef = useRef<QrCameraScannerHandle>(null);
  const autoScannerOpenedRef = useRef(false);
  const autoCreateLockedRef = useRef(false);
  const registeredKeyRef = useRef("");
  const pairingKnownRef = useRef(false);
  const pairedRef = useRef(false);
  const selectedFileRef = useRef<TransferFileSummary | null>(null);
  const preparedSourceRef = useRef<PreparedSource | null>(null);
  const sourceErrorRef = useRef("");
  const preparingSourceRef = useRef("");
  const [deviceKind, setDeviceKind] = useState<DeviceKind>("unknown");
  const [currentKey, setCurrentKey] = useState("");
  const [launcherVisible, setLauncherVisible] = useState(false);
  const [paired, setPaired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const applyPairingStatus = useCallback((payload: SessionPayload) => {
    const nextPaired = Boolean(payload.paired);
    pairingKnownRef.current = true;
    pairedRef.current = nextPaired;
    setPaired(nextPaired);
  }, []);

  const registerDevice = useCallback(async (
    key: string,
    kind: Exclude<DeviceKind, "unknown">,
  ) => {
    const response = await fetch("/api/transfer/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key,
        device_id: persistentDeviceId(),
        role: kind === "desktop" ? "host" : "join",
      }),
    });
    const payload = await response.json().catch(() => ({})) as SessionPayload;
    if (!response.ok) throw new Error(payload.error || "Không thể ghi nhận thiết bị.");
    applyPairingStatus(payload);
    return payload;
  }, [applyPairingStatus]);

  const refreshPairingStatus = useCallback(async (key: string) => {
    const response = await fetch("/api/transfer/session", {
      headers: { "x-transfer-key": key },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({})) as SessionPayload;
    if (!response.ok) throw new Error(payload.error || "Không kiểm tra được trạng thái kết nối.");
    applyPairingStatus(payload);
  }, [applyPairingStatus]);

  const sharePreparedSource = useCallback((expectedFileId: string) => {
    const source = preparedSourceRef.current;
    if (!source || source.fileId !== expectedFileId) {
      window.alert(sourceErrorRef.current || "File gốc vẫn đang được chuẩn bị. Em thử lại sau ít giây nhé.");
      return;
    }
    const sharedFile = new File([source.blob], source.name, {
      type: source.contentType || source.blob.type || "application/octet-stream",
    });
    const shareData: ShareData = { files: [sharedFile], title: source.name };
    if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
      void navigator.share(shareData).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        openBlobFallback(source);
      });
      return;
    }
    openBlobFallback(source);
  }, []);

  const updateSourceAction = useCallback(() => {
    const file = selectedFileRef.current;
    const actions = document.querySelector<HTMLElement>(".transferDocumentDetail .headerActions");
    if (!file || !actions) return;
    let button = actions.querySelector<HTMLButtonElement>(".transferSourceAction");
    if (button?.dataset.fileId !== file.id) {
      button?.remove();
      button = document.createElement("button");
      button.type = "button";
      button.className = "transferSourceAction";
      button.dataset.fileId = file.id;
      button.addEventListener("click", () => sharePreparedSource(file.id));
      const listen = actions.querySelector(".listenButton");
      if (listen?.nextSibling) actions.insertBefore(button, listen.nextSibling);
      else actions.prepend(button);
    }
    const ready = preparedSourceRef.current?.fileId === file.id;
    const failed = Boolean(sourceErrorRef.current);
    button.disabled = !ready && !failed;
    button.textContent = ready ? "Mở hoặc lưu file gốc" : failed ? "Thử mở file gốc" : "Đang chuẩn bị file gốc…";
    button.setAttribute("aria-label", ready
      ? `Mở hoặc lưu file gốc ${file.name}`
      : `Đang chuẩn bị file gốc ${file.name}`);
  }, [sharePreparedSource]);

  const prepareSource = useCallback(async (file: TransferFileSummary, key: string) => {
    if (preparingSourceRef.current === file.id || preparedSourceRef.current?.fileId === file.id) return;
    preparingSourceRef.current = file.id;
    preparedSourceRef.current = null;
    sourceErrorRef.current = "";
    updateSourceAction();
    try {
      const response = await fetch(`/api/transfer/files/${encodeURIComponent(file.id)}/source`, {
        headers: { "x-transfer-key": key },
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || "Không chuẩn bị được file gốc.");
      }
      const blob = await response.blob();
      if (selectedFileRef.current?.id !== file.id) return;
      preparedSourceRef.current = {
        fileId: file.id,
        name: file.name,
        contentType: file.contentType || blob.type,
        blob,
      };
    } catch (error) {
      if (selectedFileRef.current?.id === file.id) {
        sourceErrorRef.current = error instanceof Error ? error.message : "Không chuẩn bị được file gốc.";
      }
    } finally {
      if (preparingSourceRef.current === file.id) preparingSourceRef.current = "";
      updateSourceAction();
    }
  }, [updateSourceAction]);

  const selectFileByIndex = useCallback(async (index: number) => {
    const key = currentTransferKey();
    if (!key || index < 0) return;
    try {
      const response = await fetch("/api/transfer/files", {
        headers: { "x-transfer-key": key },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({})) as TransferListPayload;
      if (!response.ok) throw new Error(payload.error || "Không đọc được danh sách file.");
      const file = payload.files?.[index];
      if (!file) return;
      selectedFileRef.current = file;
      preparedSourceRef.current = null;
      sourceErrorRef.current = "";
      window.setTimeout(updateSourceAction, 30);
      void prepareSource(file, key);
    } catch (error) {
      sourceErrorRef.current = error instanceof Error ? error.message : "Không chuẩn bị được file gốc.";
      updateSourceAction();
    }
  }, [prepareSource, updateSourceAction]);

  useEffect(() => {
    const handleFileSelection = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>(".transferFileOpen");
      if (!button) return;
      const buttons = [...document.querySelectorAll<HTMLButtonElement>(".transferFileOpen")];
      void selectFileByIndex(buttons.indexOf(button));
    };
    document.addEventListener("click", handleFileSelection, true);
    return () => document.removeEventListener("click", handleFileSelection, true);
  }, [selectFileByIndex]);

  useEffect(() => {
    const kind = detectDeviceKind();
    setDeviceKind(kind);

    const updatePage = () => {
      const key = currentTransferKey();
      setCurrentKey((current) => current === key ? current : key);
      setLauncherVisible(kind === "mobile" && !key);

      const shell = document.querySelector<HTMLElement>(".transferShell");
      shell?.classList.toggle("transferDeviceMobile", kind === "mobile");
      shell?.classList.toggle("transferDeviceDesktop", kind === "desktop");
      shell?.classList.toggle("transferHasMailbox", Boolean(key));
      shell?.classList.toggle("transferPeerConnected", Boolean(key) && pairedRef.current);

      const eyebrow = document.querySelector<HTMLElement>(".transferHero .eyebrow");
      if (eyebrow) eyebrow.hidden = true;
      const heading = document.querySelector<HTMLElement>(".transferHero h1");
      if (heading && heading.textContent !== "Gửi file sang điện thoại.") {
        heading.textContent = "Gửi file sang điện thoại.";
      }

      enhanceStructuredTables();
      updateSourceAction();

      if (kind === "desktop" && !key) {
        const createButton = document.querySelector<HTMLButtonElement>(".pairPanel > div:first-child button");
        if (createButton && !createButton.disabled && !autoCreateLockedRef.current) {
          autoCreateLockedRef.current = true;
          createButton.click();
          window.setTimeout(() => {
            if (!currentTransferKey()) autoCreateLockedRef.current = false;
          }, 4_000);
        }
      }

      if (kind === "mobile" && !key && !autoScannerOpenedRef.current) {
        autoScannerOpenedRef.current = true;
        window.setTimeout(() => scannerRef.current?.open(), 120);
      }

      if (key && registeredKeyRef.current !== `${kind}:${key}`) {
        registeredKeyRef.current = `${kind}:${key}`;
        pairingKnownRef.current = false;
        void registerDevice(key, kind).catch((error) => {
          registeredKeyRef.current = "";
          setMessage(error instanceof Error ? error.message : "Không thể ghi nhận thiết bị.");
        });
      }

      if (
        kind === "desktop" &&
        key &&
        pairingKnownRef.current &&
        !pairedRef.current &&
        !document.querySelector(".pairQrPanel")
      ) {
        document.querySelector<HTMLButtonElement>(".connectionActions button:first-child")?.click();
      }
    };

    updatePage();
    const observer = new MutationObserver(updatePage);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(updatePage, 750);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, [registerDevice, updateSourceAction]);

  useEffect(() => {
    if (deviceKind !== "desktop" || !currentKey) return;
    const check = () => void refreshPairingStatus(currentKey).catch(() => undefined);
    check();
    const timer = window.setInterval(check, PAIRING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [currentKey, deviceKind, refreshPairingStatus]);

  useEffect(() => {
    document.querySelector(".transferShell")?.classList.toggle("transferPeerConnected", paired);
  }, [paired]);

  async function connectScannedKey(key: string) {
    setBusy(true);
    setMessage("Đang kết nối…");
    try {
      const response = await fetch("/api/transfer/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, device_id: persistentDeviceId(), role: "join" }),
      });
      const payload = await response.json().catch(() => ({})) as SessionPayload;
      if (!response.ok) throw new Error(payload.error || "Mã QR không hợp lệ.");
      window.localStorage.setItem(STORAGE_KEY, key);
      window.location.replace("/transfer");
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "Không thể kết nối bằng QR.");
    }
  }

  const desktopPreparing = deviceKind === "desktop" && !currentKey;

  return (
    <>
      {desktopPreparing ? <p className="transferAutoStatus" role="status">Đang tạo mã QR kết nối…</p> : null}
      {launcherVisible ? (
        <div className="qrScannerLauncherWrap">
          <button
            className="qrScannerLauncher"
            type="button"
            disabled={busy}
            onClick={() => scannerRef.current?.open()}
          >
            <span aria-hidden="true">⌗</span>
            {busy ? "Đang kết nối…" : "Quét QR trong ứng dụng"}
          </button>
          {message && !busy ? <p role="status">{message}</p> : null}
        </div>
      ) : null}
      <QrCameraScanner ref={scannerRef} onDetected={(key) => void connectScannedKey(key)} />
    </>
  );
}
