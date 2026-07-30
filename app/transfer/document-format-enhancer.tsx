"use client";

import { useEffect } from "react";

const APPENDIX_TITLE = /^phụ\s+lục(?:\s+(?:số\s+)?[ivxlcdm\d]+)?\b/iu;
const APPENDIX_NOTE = /^\(?\s*(?:kèm\s+theo|ban\s+hành\s+kèm\s+theo)\b/iu;
const RECIPIENTS = /^(?:nơi\s+nhận|kính\s+gửi)\s*:/iu;
const SIGNATURE_ROLE = /^(?:(?:kt|tl|tuq|q)\.\s*)?(?:bộ\s+trưởng|thứ\s+trưởng|thủ\s+trưởng|chủ\s+tịch|phó\s+chủ\s+tịch|tổng\s+cục\s+trưởng|phó\s+tổng\s+cục\s+trưởng|cục\s+trưởng|phó\s+cục\s+trưởng|giám\s+đốc|phó\s+giám\s+đốc|chánh\s+văn\s+phòng|phó\s+chánh\s+văn\s+phòng|thừa\s+lệnh|thừa\s+ủy\s+quyền)\b/iu;
const SIGNATURE_PREFIX = /^(?:đã\s+ký|ký\s+thay|ký\s+thừa\s+lệnh)\b/iu;

function normalized(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function likelySignerName(value: string) {
  const text = normalized(value);
  if (!text || text.length > 70 || /[:;,.!?()]/u.test(text)) return false;
  const words = text.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 7) return false;
  return words.every((word) => /^[\p{Lu}Đ][\p{L}Đđ'’-]*$/u.test(word));
}

function allCapsHeading(value: string) {
  const text = normalized(value);
  if (text.length < 8 || text.length > 220 || /[.!?;:]$/u.test(text)) return false;
  const letters = [...text].filter((character) => /\p{L}/u.test(character));
  if (letters.length < 5) return false;
  const uppercase = letters.filter((character) => character === character.toLocaleUpperCase("vi")).length;
  return uppercase / letters.length >= 0.86;
}

function clearClasses(block: HTMLElement) {
  block.classList.remove(
    "transferAppendixTitle",
    "transferAppendixNote",
    "transferDocumentSectionTitle",
    "transferRecipients",
    "transferSignatureRole",
    "transferSignerName",
  );
}

function polishProvision(provision: HTMLElement) {
  const blocks = [...provision.querySelectorAll<HTMLElement>(".legalBlocks .legalBlock")]
    .filter((block) => !block.classList.contains("transferTableBlock"));
  if (!blocks.length) return;

  let appendixContext = 0;
  let waitingForSigner = false;
  blocks.forEach((block) => {
    clearClasses(block);
    const text = normalized(block.textContent ?? "");
    if (!text) return;

    if (APPENDIX_TITLE.test(text)) {
      block.classList.add("transferAppendixTitle");
      appendixContext = 2;
      waitingForSigner = false;
      return;
    }

    if (appendixContext > 0 && (APPENDIX_NOTE.test(text) || allCapsHeading(text))) {
      block.classList.add("transferAppendixNote");
      appendixContext -= 1;
      return;
    }
    appendixContext = Math.max(0, appendixContext - 1);

    if (RECIPIENTS.test(text)) {
      block.classList.add("transferRecipients");
      waitingForSigner = false;
      return;
    }

    if (SIGNATURE_ROLE.test(text) || SIGNATURE_PREFIX.test(text)) {
      block.classList.add("transferSignatureRole");
      waitingForSigner = true;
      return;
    }

    if (waitingForSigner && likelySignerName(text)) {
      block.classList.add("transferSignerName");
      waitingForSigner = false;
      return;
    }

    if (allCapsHeading(text) && !/^CỘNG\s+HÒA|^ĐỘC\s+LẬP|^SỐ\s*:/iu.test(text)) {
      block.classList.add("transferDocumentSectionTitle");
    }
  });

  provision.dataset.transferDocumentPolished = "2";
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
