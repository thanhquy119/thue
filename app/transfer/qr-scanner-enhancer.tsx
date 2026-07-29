"use client";

import { useEffect, useRef, useState } from "react";
import QrCameraScanner, { type QrCameraScannerHandle } from "./qr-camera-scanner";

const STORAGE_KEY = "thue-transfer-key-v1";

export default function QrScannerEnhancer() {
  const scannerRef = useRef<QrCameraScannerHandle>(null);
  const [launcherVisible, setLauncherVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const update = () => setLauncherVisible(Boolean(document.querySelector(".pairPanel, .connectionBar")));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  async function connectScannedKey(key: string) {
    setBusy(true);
    setMessage("Đang kết nối…");
    try {
      const response = await fetch("/api/transfer/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Mã QR không hợp lệ.");
      window.localStorage.setItem(STORAGE_KEY, key);
      window.location.replace("/transfer");
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "Không thể kết nối bằng QR.");
    }
  }

  return (
    <>
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
