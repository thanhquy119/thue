"use client";

import { useEffect } from "react";
import {
  classifyTransferDocumentBlocks,
  type TransferDocumentRole,
} from "@/lib/transfer/document-semantics";

const ROLE_CLASS: Record<TransferDocumentRole, string | null> = {
  normal: null,
  "appendix-title": "transferAppendixTitle",
  "appendix-note": "transferAppendixNote",
  "section-title": "transferDocumentSectionTitle",
  recipients: "transferRecipients",
  "signature-role": "transferSignatureRole",
  "signer-name": "transferSignerName",
};

const SEMANTIC_CLASSES = Object.values(ROLE_CLASS).filter((value): value is string => Boolean(value));

function polishProvision(provision: HTMLElement) {
  const blocks = [...provision.querySelectorAll<HTMLElement>(".legalBlocks .legalBlock")]
    .filter((block) => !block.classList.contains("transferTableBlock"));
  if (!blocks.length) return;

  const roles = classifyTransferDocumentBlocks(blocks.map((block) => block.textContent ?? ""));
  blocks.forEach((block, index) => {
    block.classList.remove(...SEMANTIC_CLASSES);
    const className = ROLE_CLASS[roles[index] ?? "normal"];
    if (className) block.classList.add(className);
  });

  provision.dataset.transferDocumentPolished = "3";
}

function polishAllDocuments() {
  document.querySelectorAll<HTMLElement>(".transferDocumentDetail .legalProvision").forEach(polishProvision);
}

export default function DocumentFormatEnhancer() {
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(polishAllDocuments);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const timer = window.setInterval(schedule, 1_500);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
