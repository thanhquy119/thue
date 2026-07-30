"use client";

import { useEffect } from "react";

const OCR_QUEUE_TEXT = "PDF scan đang xếp hàng OCR chậm để bảo vệ hạn mức";
const OPEN_ERROR = /không mở được file|xử lý file thất bại/iu;

type OpeningFile = {
  row: HTMLElement;
  button: HTMLButtonElement;
  name: string;
  startedAt: number;
  timeout: number;
};

function selectedFileName() {
  return document.querySelector<HTMLElement>(".transferDocumentDetail .detailHeader h2")
    ?.textContent
    ?.trim() ?? "";
}

export default function TransferUxEnhancer() {
  useEffect(() => {
    let opening: OpeningFile | null = null;

    const clearOpening = () => {
      if (!opening) return;
      window.clearTimeout(opening.timeout);
      opening.row.classList.remove("isOpening");
      opening.button.removeAttribute("aria-busy");
      opening = null;
    };

    const rewriteMessages = () => {
      document.querySelectorAll<HTMLElement>(".transferMessage").forEach((message) => {
        const text = message.textContent ?? "";
        if (text.includes(OCR_QUEUE_TEXT)) message.textContent = "Đã gửi file.";
      });
    };

    const reconcileOpening = () => {
      if (!opening) return;
      if (!document.contains(opening.row)) {
        clearOpening();
        return;
      }
      const elapsed = Date.now() - opening.startedAt;
      const message = document.querySelector<HTMLElement>(".transferMessage")?.textContent ?? "";
      if (OPEN_ERROR.test(message) || (elapsed >= 300 && selectedFileName() === opening.name)) {
        clearOpening();
      }
    };

    const reconcile = () => {
      rewriteMessages();
      reconcileOpening();
    };

    const handleClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>(".transferFileOpen");
      if (!button || button.disabled) return;
      const row = button.closest<HTMLElement>(".transferFile");
      if (!row) return;

      clearOpening();
      row.classList.add("isOpening");
      button.setAttribute("aria-busy", "true");
      opening = {
        row,
        button,
        name: button.querySelector("strong")?.textContent?.trim() ?? "",
        startedAt: Date.now(),
        timeout: window.setTimeout(clearOpening, 20_000),
      };
    };

    document.addEventListener("click", handleClick, true);
    const observer = new MutationObserver(reconcile);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const timer = window.setInterval(reconcile, 250);
    reconcile();

    return () => {
      document.removeEventListener("click", handleClick, true);
      observer.disconnect();
      window.clearInterval(timer);
      clearOpening();
    };
  }, []);

  return null;
}
