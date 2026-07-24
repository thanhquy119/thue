"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type PushConfig = {
  enabled: boolean;
  publicKey: string | null;
  reason: string | null;
};

type NotificationState = "loading" | "unsupported" | "unavailable" | "off" | "on" | "denied";

type ServiceWorkerMessage = {
  type?: string;
  number?: string;
};

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function isIosDevice() {
  const navigatorWithTouch = navigator as Navigator & { standalone?: boolean };
  return /iPad|iPhone|iPod/iu.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ||
    navigatorWithTouch.standalone === true;
}

function isStandaloneApp() {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

function openDocument(number: string) {
  const input = document.getElementById("legal-search") as HTMLInputElement | null;
  const form = input?.closest("form") as HTMLFormElement | null;
  if (!input || !form) return false;

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, number);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  window.setTimeout(() => form.requestSubmit(), 0);
  return true;
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export default function NotificationSettings() {
  const [topbar, setTopbar] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<NotificationState>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const supported = useMemo(
    () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
    [],
  );

  useEffect(() => {
    setTopbar(document.querySelector<HTMLElement>(".topbar"));
    if (!supported) {
      setState("unsupported");
      setReason("Trình duyệt này chưa hỗ trợ Web Push.");
      return;
    }

    let cancelled = false;
    async function initialize() {
      try {
        const response = await fetch("/api/notifications/config", { cache: "no-store" });
        const config = await response.json() as PushConfig;
        if (cancelled) return;
        setPublicKey(config.publicKey);
        setReason(config.reason ?? "");
        if (!response.ok || !config.enabled || !config.publicKey) {
          setState("unavailable");
          return;
        }

        await navigator.serviceWorker.register("/sw.js");
        const subscription = await currentSubscription();
        if (cancelled) return;
        if (subscription) setState("on");
        else if (Notification.permission === "denied") setState("denied");
        else setState("off");
      } catch (error) {
        if (cancelled) return;
        setState("unavailable");
        setReason(error instanceof Error ? error.message : "Không kiểm tra được Web Push.");
      }
    }
    void initialize();

    const onServiceWorkerMessage = (event: MessageEvent<ServiceWorkerMessage>) => {
      if (event.data?.type !== "THUE_OPEN_DOCUMENT" || !event.data.number) return;
      setOpen(false);
      openDocument(event.data.number);
    };
    navigator.serviceWorker.addEventListener("message", onServiceWorkerMessage);

    const number = new URLSearchParams(window.location.search).get("document")?.trim();
    if (number) {
      window.setTimeout(() => {
        if (openDocument(number)) {
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete("document");
          cleanUrl.searchParams.delete("source");
          window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
        }
      }, 120);
    }

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("message", onServiceWorkerMessage);
    };
  }, [supported]);

  async function enableNotifications() {
    if (!supported || !publicKey) return;
    setBusy(true);
    setNotice("");
    try {
      if (isIosDevice() && !isStandaloneApp()) {
        throw new Error("Trên iPhone hoặc iPad, hãy thêm Thuế vào Màn hình chính rồi mở từ biểu tượng ứng dụng trước khi bật thông báo.");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        throw new Error(permission === "denied"
          ? "Thông báo đang bị chặn trong cài đặt của trình duyệt."
          : "Bạn chưa cho phép thông báo.");
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      const created = !subscription;
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(publicKey),
        });
      }

      const response = await fetch("/api/notifications/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      const payload = await response.json() as { error?: string; welcome_sent?: boolean };
      if (!response.ok) {
        if (created) await subscription.unsubscribe().catch(() => undefined);
        throw new Error(payload.error || "Không lưu được thiết bị nhận thông báo.");
      }

      setState("on");
      setNotice(payload.welcome_sent === false
        ? "Đã bật thông báo. Thông báo thử chưa gửi được nhưng thiết bị vẫn được lưu để thử ở văn bản tiếp theo."
        : "Đã bật. Thiết bị này sẽ nhận một thông báo xác nhận.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không bật được thông báo.");
    } finally {
      setBusy(false);
    }
  }

  async function disableNotifications() {
    setBusy(true);
    setNotice("");
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        const response = await fetch("/api/notifications/subscriptions", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error || "Không hủy được thiết bị nhận thông báo.");
        await subscription.unsubscribe();
      }
      setState("off");
      setNotice("Đã tắt thông báo trên thiết bị này.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không tắt được thông báo.");
    } finally {
      setBusy(false);
    }
  }

  const statusCopy = state === "on"
    ? ["Đang bật", "Thiết bị này sẽ nhận thông báo văn bản mới."]
    : state === "denied"
      ? ["Đang bị chặn", "Hãy cho phép thông báo trong cài đặt trình duyệt rồi thử lại."]
      : state === "unsupported"
        ? ["Không được hỗ trợ", reason || "Trình duyệt này chưa hỗ trợ Web Push."]
        : state === "unavailable"
          ? ["Chưa sẵn sàng", reason || "Máy chủ thông báo chưa sẵn sàng."]
          : state === "loading"
            ? ["Đang kiểm tra", "Đang kiểm tra khả năng nhận thông báo trên thiết bị."]
            : ["Đang tắt", "Thông báo chỉ được bật sau khi bạn đồng ý trên thiết bị này."];

  return (
    <>
      {topbar
        ? createPortal(
            <button
              className={`notificationLink ${state === "on" ? "active" : ""}`}
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Cài đặt thông báo văn bản mới"
            >
              Thông báo{state === "on" ? <span aria-hidden="true">✓</span> : null}
            </button>,
            topbar,
          )
        : null}

      {open ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-labelledby="notification-title" onClick={() => setOpen(false)}>
          <section className="notificationSheet" onClick={(event) => event.stopPropagation()}>
            <button className="closeButton" type="button" onClick={() => setOpen(false)} aria-label="Đóng">×</button>
            <p className="eyebrow">Kênh cập nhật</p>
            <h2 id="notification-title">Nhận thông báo văn bản mới</h2>
            <p className="notificationIntro">
              Chỉ thông báo khi toàn văn từ nguồn chính thức đã được nhập đầy đủ và vượt kiểm tra chất lượng. OCR còn dở hoặc văn bản cần xem xét sẽ không được gửi.
            </p>

            <div className={`notificationStatus ${state === "on" ? "active" : ""}`}>
              <span className="notificationDot" aria-hidden="true" />
              <div><strong>{statusCopy[0]}</strong><p>{statusCopy[1]}</p></div>
            </div>

            {notice ? <p className="notificationNotice" role="status">{notice}</p> : null}

            <div className="notificationActions">
              {state !== "on" ? (
                <button
                  className="notificationPrimary"
                  type="button"
                  onClick={enableNotifications}
                  disabled={busy || state === "loading" || state === "unsupported" || state === "unavailable"}
                >
                  {busy ? "Đang bật…" : "Bật thông báo"}
                </button>
              ) : (
                <button className="notificationSecondary" type="button" onClick={disableNotifications} disabled={busy}>
                  {busy ? "Đang tắt…" : "Tắt trên thiết bị này"}
                </button>
              )}
            </div>

            <small className="notificationPrivacy">
              Không cần tài khoản. Thuế chỉ lưu endpoint kỹ thuật của thiết bị trong Private Blob và tự xóa endpoint đã hết hiệu lực.
            </small>
          </section>
        </div>
      ) : null}
    </>
  );
}
