"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QrCameraScanner, { type QrCameraScannerHandle } from "./qr-camera-scanner";

const STORAGE_KEY = "thue-transfer-key-v1";
const DEVICE_STORAGE_KEY = "thue-transfer-device-v1";
const PAIRING_POLL_MS = 2_000;

type DeviceKind = "unknown" | "desktop" | "mobile";
type SessionPayload = {
  error?: string;
  paired?: boolean;
  device_count?: number;
};

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

export default function QrScannerEnhancer() {
  const scannerRef = useRef<QrCameraScannerHandle>(null);
  const autoScannerOpenedRef = useRef(false);
  const autoCreateLockedRef = useRef(false);
  const registeredKeyRef = useRef("");
  const pairingKnownRef = useRef(false);
  const pairedRef = useRef(false);
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
  }, [registerDevice]);

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
