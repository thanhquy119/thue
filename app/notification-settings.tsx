"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  clearNotificationHistory,
  readNotificationHistory,
} from "@/lib/notifications/history-client";
import type { NotificationHistoryItem } from "@/lib/notifications/history-core";

type PushConfig = {
  enabled: boolean;
  publicKey: string | null;
  reason: string | null;
};

type NotificationState = "loading" | "unsupported" | "unavailable" | "off" | "on" | "denied";
type PanelMode = "prompt" | "history";

type ServiceWorkerMessage = {
  type?: string;
  number?: string;
};

const ONBOARDING_KEY = "thue-notification-onboarding-v1";

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

function historyTime(receivedAt: number) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(receivedAt));
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export default function NotificationSettings() {
  const [topbar, setTopbar] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>("prompt");
  const [onboardingSeen, setOnboardingSeen] = useState(false);
  const [state, setState] = useState<NotificationState>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<NotificationHistoryItem[]>([]);

  const supported = useMemo(
    () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
    [],
  );

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      setHistory(await readNotificationHistory());
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const rememberOnboarding = useCallback(() => {
    window.localStorage.setItem(ONBOARDING_KEY, "seen");
    setOnboardingSeen(true);
  }, []);

  useEffect(() => {
    setTopbar(document.querySelector<HTMLElement>(".topbar"));
    const seen = window.localStorage.getItem(ONBOARDING_KEY) === "seen";
    setOnboardingSeen(seen);
    void refreshHistory();

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
        if (subscription) {
          setState("on");
          if (!seen) {
            window.localStorage.setItem(ONBOARDING_KEY, "seen");
            setOnboardingSeen(true);
          }
        } else if (Notification.permission === "denied") {
          setState("denied");
        } else {
          setState("off");
        }
      } catch (error) {
        if (cancelled) return;
        setState("unavailable");
        setReason(error instanceof Error ? error.message : "Không kiểm tra được Web Push.");
      }
    }
    void initialize();

    const onServiceWorkerMessage = (event: MessageEvent<ServiceWorkerMessage>) => {
      if (event.data?.type === "THUE_NOTIFICATION_HISTORY_UPDATED") {
        void refreshHistory();
        return;
      }
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
  }, [refreshHistory, supported]);

  function openPanel() {
    setNotice("");
    const mode = !onboardingSeen && state !== "on" ? "prompt" : "history";
    setPanelMode(mode);
    setOpen(true);
    if (mode === "prompt") rememberOnboarding();
    else void refreshHistory();
  }

  async function enableNotifications() {
    if (!supported || !publicKey) return;
    rememberOnboarding();
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
      setPanelMode("history");
      setNotice(payload.welcome_sent === false
        ? "Đã bật. Máy chủ sẽ thử gửi lại ở văn bản tiếp theo."
        : "Đã bật thông báo trên thiết bị này.");
      window.setTimeout(() => void refreshHistory(), 500);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không bật được thông báo.");
    } finally {
      setBusy(false);
    }
  }

  function skipOnboarding() {
    setOpen(false);
  }

  async function clearHistory() {
    setHistoryLoading(true);
    try {
      await clearNotificationHistory();
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  function openHistoryItem(item: NotificationHistoryItem) {
    setOpen(false);
    if (item.number && openDocument(item.number)) return;
    window.location.assign(item.url);
  }

  const cannotEnable = busy || state === "loading" || state === "unsupported" || state === "unavailable" || state === "denied";
  const blockedReason = state === "denied"
    ? "Trình duyệt đang chặn thông báo."
    : state === "unsupported" || state === "unavailable"
      ? reason
      : "";

  return (
    <>
      {topbar
        ? createPortal(
            <button
              className={`notificationLink ${state === "on" ? "active" : ""}`}
              type="button"
              onClick={openPanel}
              aria-label="Mở lịch sử thông báo"
              title="Thông báo"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
              </svg>
              {history.length ? <span className="notificationBadge" aria-hidden="true">{Math.min(history.length, 99)}</span> : null}
            </button>,
            topbar,
          )
        : null}

      {open ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-labelledby="notification-title" onClick={() => setOpen(false)}>
          <section className="notificationSheet" onClick={(event) => event.stopPropagation()}>
            <button className="closeButton" type="button" onClick={() => setOpen(false)} aria-label="Đóng">×</button>

            {panelMode === "prompt" ? (
              <>
                <p className="eyebrow">Thông báo</p>
                <h2 id="notification-title">Bật thông báo?</h2>
                <p className="notificationPromptCopy">Nhận cập nhật khi có văn bản mới.</p>
                {blockedReason ? <p className="notificationNotice" role="status">{blockedReason}</p> : null}
                {notice ? <p className="notificationNotice" role="status">{notice}</p> : null}
                <div className="notificationActions notificationPromptActions">
                  <button className="notificationPrimary" type="button" onClick={enableNotifications} disabled={cannotEnable}>
                    {busy ? "Đang bật…" : "Bật thông báo"}
                  </button>
                  <button className="notificationSecondary" type="button" onClick={skipOnboarding} disabled={busy}>
                    Để sau
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="notificationHistoryHeader">
                  <div>
                    <p className="eyebrow">7 ngày gần đây</p>
                    <h2 id="notification-title">Lịch sử thông báo</h2>
                  </div>
                  {state !== "on" ? (
                    <button className="notificationToggle" type="button" onClick={enableNotifications} disabled={cannotEnable}>
                      {busy ? "Đang bật…" : "Bật"}
                    </button>
                  ) : null}
                </div>

                {blockedReason ? <p className="notificationNotice" role="status">{blockedReason}</p> : null}
                {notice ? <p className="notificationNotice" role="status">{notice}</p> : null}

                {historyLoading ? (
                  <p className="notificationEmpty">Đang tải…</p>
                ) : history.length ? (
                  <ul className="notificationHistoryList">
                    {history.map((item) => (
                      <li key={item.id}>
                        <button type="button" onClick={() => openHistoryItem(item)}>
                          <span className="notificationHistoryTitle">{item.title}</span>
                          <span className="notificationHistoryBody">{item.body}</span>
                          <time dateTime={new Date(item.receivedAt).toISOString()}>{historyTime(item.receivedAt)}</time>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="notificationEmpty">Chưa có thông báo nào.</p>
                )}

                <div className="notificationHistoryFooter">
                  <span>Tự xóa sau 7 ngày.</span>
                  {history.length ? (
                    <button type="button" onClick={clearHistory} disabled={historyLoading}>Xóa lịch sử</button>
                  ) : null}
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
