"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { pairingKeyFromQr } from "@/lib/transfer/qr-pairing";

const JS_QR_SOURCE = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
const SCAN_INTERVAL_MS = 160;
const MAX_SCAN_WIDTH = 720;

type JsQrResult = { data: string } | null;
type JsQrDecoder = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" },
) => JsQrResult;

declare global {
  interface Window {
    jsQR?: JsQrDecoder;
  }
}

export type QrCameraScannerHandle = {
  open: () => void;
};

type Props = {
  onDetected: (key: string) => void;
};

let decoderPromise: Promise<JsQrDecoder> | null = null;

function loadDecoder() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (decoderPromise) return decoderPromise;
  decoderPromise = new Promise<JsQrDecoder>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${JS_QR_SOURCE}"]`);
    const script = existing ?? document.createElement("script");
    const finish = () => window.jsQR
      ? resolve(window.jsQR)
      : reject(new Error("Không tải được bộ đọc mã QR."));
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("Không tải được bộ đọc mã QR.")), { once: true });
    if (!existing) {
      script.src = JS_QR_SOURCE;
      script.async = true;
      script.crossOrigin = "anonymous";
      document.head.appendChild(script);
    }
  }).catch((error) => {
    decoderPromise = null;
    throw error;
  });
  return decoderPromise;
}

const QrCameraScanner = forwardRef<QrCameraScannerHandle, Props>(function QrCameraScanner({ onDetected }, ref) {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState("Đang chuẩn bị camera…");
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const sessionRef = useRef(0);

  const stop = useCallback(() => {
    sessionRef.current += 1;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const close = useCallback(() => {
    stop();
    setVisible(false);
    setError("");
  }, [stop]);

  const begin = useCallback(async () => {
    stop();
    setVisible(true);
    setError("");
    setStatus("Đang xin quyền dùng camera…");
    const session = sessionRef.current;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("Thiết bị này chưa cho phép PWA mở camera.");
      }
      const decoderTask = loadDecoder();
      const streamTask = navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      const [decoder, stream] = await Promise.all([decoderTask, streamTask]);
      if (session !== sessionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) throw new Error("Không khởi tạo được khung quét QR.");
      video.srcObject = stream;
      await video.play();
      setStatus("Đưa mã QR vào giữa khung hình");

      const scan = () => {
        if (session !== sessionRef.current || !streamRef.current) return;
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
          const scale = Math.min(1, MAX_SCAN_WIDTH / video.videoWidth);
          const width = Math.max(1, Math.round(video.videoWidth * scale));
          const height = Math.max(1, Math.round(video.videoHeight * scale));
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (context) {
            context.drawImage(video, 0, 0, width, height);
            const image = context.getImageData(0, 0, width, height);
            const result = decoder(image.data, width, height, { inversionAttempts: "attemptBoth" });
            if (result?.data) {
              const key = pairingKeyFromQr(result.data, window.location.origin);
              if (key) {
                navigator.vibrate?.(70);
                stop();
                setVisible(false);
                onDetected(key);
                return;
              }
              setStatus("QR này không phải mã kết nối của Thuế Rõ");
            }
          }
        }
        timerRef.current = window.setTimeout(scan, SCAN_INTERVAL_MS);
      };
      scan();
    } catch (caught) {
      stop();
      const message = caught instanceof DOMException && caught.name === "NotAllowedError"
        ? "Camera đang bị từ chối. Hãy cho phép Camera cho ứng dụng này trong Cài đặt rồi thử lại."
        : caught instanceof Error ? caught.message : "Không mở được camera.";
      setError(message);
      setStatus("");
    }
  }, [onDetected, stop]);

  useImperativeHandle(ref, () => ({ open: () => void begin() }), [begin]);
  useEffect(() => stop, [stop]);

  return (
    <div className={`qrScannerOverlay ${visible ? "visible" : ""}`} aria-hidden={!visible}>
      <section className="qrScannerDialog" role="dialog" aria-modal="true" aria-labelledby="qr-scanner-title">
        <div className="qrScannerHeading">
          <div>
            <p className="sectionLabel">Kết nối trong PWA</p>
            <h2 id="qr-scanner-title">Quét mã QR bằng camera</h2>
          </div>
          <button type="button" onClick={close} aria-label="Đóng trình quét QR">×</button>
        </div>
        <div className="qrScannerViewport">
          <video ref={videoRef} autoPlay muted playsInline aria-label="Hình ảnh từ camera sau" />
          <span className="qrScannerFrame" aria-hidden="true" />
          <canvas ref={canvasRef} hidden />
        </div>
        {status ? <p className="qrScannerStatus">{status}</p> : null}
        {error ? (
          <div className="qrScannerError" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => void begin()}>Thử mở lại camera</button>
          </div>
        ) : null}
        <p className="qrScannerPrivacy">Khung hình chỉ được xử lý ngay trên thiết bị và không được tải lên máy chủ.</p>
      </section>
    </div>
  );
});

export default QrCameraScanner;
