"use client";

import { useEffect } from "react";

const HEADER_HINT = /\b(?:stt|số\s+thứ\s+tự|nhóm|tiêu\s+chí|nội\s+dung|mã|đơn\s+vị|số\s+tiền|tỷ\s+trọng|trạng\s+thái|ngày|tháng|năm|ghi\s+chú)\b/iu;
const NUMERIC_VALUE = /^\s*[-+]?\d[\d\s.,/%₫đ]*\s*$/iu;

function normalized(value: string) {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase("vi");
}

function cellsOf(row: Element) {
  return [...row.querySelectorAll<HTMLElement>(":scope > .transferStructuredCell")];
}

function rowTexts(row: Element) {
  return cellsOf(row).map((cell) => normalized(cell.textContent ?? ""));
}

function looksNumeric(value: string) {
  return Boolean(value) && NUMERIC_VALUE.test(value);
}

function inferHeaderRows(rows: HTMLElement[]) {
  if (!rows.length) return 0;
  let count = 1;
  for (let index = 1; index < Math.min(3, rows.length); index += 1) {
    const texts = rowTexts(rows[index]);
    const first = texts.find(Boolean) ?? "";
    const joined = texts.join(" ");
    const numericRatio = texts.length
      ? texts.filter(looksNumeric).length / texts.length
      : 0;
    const nextFirst = index + 1 < rows.length ? rowTexts(rows[index + 1]).find(Boolean) ?? "" : "";
    const headerLike = HEADER_HINT.test(joined) ||
      (!looksNumeric(first) && looksNumeric(nextFirst) && numericRatio < 0.4);
    if (!headerLike) break;
    count = index + 1;
  }
  return count;
}

function columnWidths(rows: HTMLElement[], columnCount: number) {
  const widths: number[] = [];
  const sample = rows.slice(0, 60).map(rowTexts);
  for (let column = 0; column < columnCount; column += 1) {
    const values = sample.map((row) => row[column] ?? "").filter(Boolean);
    const longest = values.reduce((maximum, value) => Math.max(maximum, value.length), 0);
    const numericRatio = values.length
      ? values.filter(looksNumeric).length / values.length
      : 0;
    let width = longest <= 3
      ? 82
      : longest <= 10
        ? 116
        : longest <= 24
          ? 168
          : longest <= 52
            ? 232
            : 310;
    if (numericRatio >= 0.72) width = Math.min(width, 132);
    if (column === 0 && numericRatio >= 0.5) width = Math.min(width, 88);
    widths.push(width);
  }
  return widths;
}

function responsiveTemplate(widths: number[]) {
  return widths
    .map((width) => `minmax(${width}px, ${Math.max(1, width / 120).toFixed(2)}fr)`)
    .join(" ");
}

function polishTable(table: HTMLElement) {
  if (table.dataset.transferTablePolished === "3") return;
  const rows = [...table.querySelectorAll<HTMLElement>(":scope > .transferStructuredRow")];
  if (!rows.length) return;
  const columnCount = Math.max(...rows.map((row) => cellsOf(row).length));
  if (columnCount < 2) return;

  const widths = columnWidths(rows, columnCount);
  table.style.setProperty("--transfer-table-template", responsiveTemplate(widths));
  table.style.setProperty("--transfer-table-min-width", `${widths.reduce((sum, width) => sum + width, 0)}px`);
  table.classList.toggle("transferWideTable", columnCount >= 7);
  table.classList.toggle("transferVeryWideTable", columnCount >= 14);

  const headerRows = inferHeaderRows(rows);
  const firstHeaderSignature = normalized(rows[0].textContent ?? "");
  rows.forEach((row, rowIndex) => {
    const repeatedHeader = rowIndex >= headerRows &&
      firstHeaderSignature.length > 4 &&
      normalized(row.textContent ?? "") === firstHeaderSignature;
    const header = rowIndex < headerRows || repeatedHeader;
    row.classList.toggle("transferStructuredHeaderRow", header);
    row.classList.toggle("transferStructuredRepeatedHeader", repeatedHeader);
    row.classList.toggle("transferStructuredDataRow", !header);

    cellsOf(row).forEach((cell, columnIndex) => {
      const text = normalized(cell.textContent ?? "");
      cell.setAttribute("role", header ? "columnheader" : "cell");
      cell.classList.toggle("transferStructuredStickyCell", columnCount >= 4 && columnIndex === 0);
      cell.classList.toggle("transferStructuredNumericCell", !header && looksNumeric(text));
      cell.classList.toggle("transferStructuredEmptyCell", !text);
    });
  });

  const block = table.closest<HTMLElement>(".transferTableBlock");
  block?.classList.toggle("transferTableHasManyColumns", columnCount >= 7);
  block?.setAttribute("aria-label", `Bảng gồm ${rows.length} hàng và ${columnCount} cột. Chạm để nghe nội dung bảng.`);
  table.dataset.transferTablePolished = "3";
}

function polishAllTables() {
  document.querySelectorAll<HTMLElement>(".transferStructuredTable").forEach(polishTable);
}

export default function TableFormatEnhancer() {
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(polishAllTables);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(schedule, 1_500);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
