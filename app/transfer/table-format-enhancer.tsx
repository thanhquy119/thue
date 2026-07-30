"use client";

import { useEffect } from "react";

const HEADER_HINT = /\b(?:stt|số\s+thứ\s+tự|nhóm|tiêu\s+chí|nội\s+dung|mã|đơn\s+vị|số\s+tiền|tỷ\s+trọng|trạng\s+thái|ngày|tháng|năm|ghi\s+chú)\b/iu;
const NUMERIC_VALUE = /^\s*[-+]?\d[\d\s.,/%₫đ]*\s*$/iu;
const POLISH_VERSION = "4";

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
  for (let index = 1; index < Math.min(4, rows.length); index += 1) {
    const texts = rowTexts(rows[index]);
    const first = texts.find(Boolean) ?? "";
    const joined = texts.join(" ");
    const numericRatio = texts.length
      ? texts.filter(looksNumeric).length / texts.length
      : 0;
    const nextFirst = index + 1 < rows.length ? rowTexts(rows[index + 1]).find(Boolean) ?? "" : "";
    const headerLike = HEADER_HINT.test(joined) ||
      (/^\(\d+\)$/u.test(first) && numericRatio < 0.65) ||
      (!looksNumeric(first) && looksNumeric(nextFirst) && numericRatio < 0.4);
    if (!headerLike) break;
    count = index + 1;
  }
  return count;
}

function columnWidths(rows: HTMLElement[], columnCount: number) {
  const widths: number[] = [];
  const sample = rows.slice(0, 80).map(rowTexts);
  for (let column = 0; column < columnCount; column += 1) {
    const values = sample.map((row) => row[column] ?? "").filter(Boolean);
    const longest = values.reduce((maximum, value) => Math.max(maximum, value.length), 0);
    const numericRatio = values.length
      ? values.filter(looksNumeric).length / values.length
      : 0;
    let width = longest <= 3
      ? 72
      : longest <= 10
        ? 108
        : longest <= 24
          ? 158
          : longest <= 52
            ? 218
            : 284;
    if (numericRatio >= 0.72) width = Math.min(width, 124);
    if (column === 0 && numericRatio >= 0.5) width = Math.min(width, 78);
    widths.push(width);
  }
  return widths;
}

function fitCompactWidths(widths: number[], available: number, columnCount: number) {
  if (columnCount > 4 || available < 620) return widths;
  const target = Math.max(620, available - 2);
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= target) return widths;

  const minimums = widths.map((_, index) => index === 0 ? 66 : 116);
  const minimumTotal = minimums.reduce((sum, width) => sum + width, 0);
  if (minimumTotal >= target) return minimums;

  const reducible = total - minimumTotal;
  const required = total - target;
  return widths.map((width, index) => {
    const capacity = width - minimums[index];
    const reduction = reducible > 0 ? required * (capacity / reducible) : 0;
    return Math.max(minimums[index], Math.round(width - reduction));
  });
}

function responsiveTemplate(widths: number[]) {
  return widths
    .map((width) => `minmax(${width}px, ${Math.max(1, width / 120).toFixed(2)}fr)`)
    .join(" ");
}

function placeRowCells(row: HTMLElement, header: boolean, columnCount: number) {
  const cells = cellsOf(row);
  const texts = cells.map((cell) => normalized(cell.textContent ?? ""));
  const meaningful = texts
    .map((text, index) => ({ text, index }))
    .filter((item) => Boolean(item.text));
  const sectionRow = meaningful.length === 1 && !looksNumeric(meaningful[0]?.text ?? "");

  cells.forEach((cell, columnIndex) => {
    cell.hidden = false;
    cell.removeAttribute("aria-hidden");
    cell.style.gridColumn = String(columnIndex + 1);
    cell.classList.remove("transferStructuredMergedCell");
  });

  if (!header && !sectionRow) return;

  meaningful.forEach((item, meaningfulIndex) => {
    const next = meaningful[meaningfulIndex + 1]?.index ?? columnCount;
    const span = Math.max(1, next - item.index);
    if (span <= 1) return;
    const cell = cells[item.index];
    if (!cell) return;
    cell.style.gridColumn = `${item.index + 1} / span ${span}`;
    cell.classList.add("transferStructuredMergedCell");
    for (let index = item.index + 1; index < item.index + span; index += 1) {
      const covered = cells[index];
      if (!covered || texts[index]) continue;
      covered.hidden = true;
      covered.setAttribute("aria-hidden", "true");
    }
  });

  row.classList.toggle("transferStructuredSectionRow", sectionRow);
}

function polishTable(table: HTMLElement) {
  const rows = [...table.querySelectorAll<HTMLElement>(":scope > .transferStructuredRow")];
  if (!rows.length) return;
  const columnCount = Math.max(...rows.map((row) => cellsOf(row).length));
  if (columnCount < 2) return;

  const viewportWidth = Math.round(table.clientWidth);
  const widthSignature = `${POLISH_VERSION}:${viewportWidth}`;
  const firstPolish = table.dataset.transferTablePolished !== POLISH_VERSION;
  if (!firstPolish && table.dataset.transferTableWidth === widthSignature) return;

  const naturalWidths = columnWidths(rows, columnCount);
  const widths = fitCompactWidths(naturalWidths, viewportWidth, columnCount);
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
    placeRowCells(row, header, columnCount);

    cellsOf(row).forEach((cell, columnIndex) => {
      const text = normalized(cell.textContent ?? "");
      cell.setAttribute("role", header ? "columnheader" : "cell");
      cell.classList.toggle("transferStructuredStickyCell", columnCount >= 7 && columnIndex === 0);
      cell.classList.toggle("transferStructuredNumericCell", !header && looksNumeric(text));
      cell.classList.toggle("transferStructuredEmptyCell", !text && !cell.hidden);
    });
  });

  if (firstPolish) {
    table.scrollLeft = 0;
    window.requestAnimationFrame(() => { table.scrollLeft = 0; });
  }

  const block = table.closest<HTMLElement>(".transferTableBlock");
  block?.classList.toggle("transferTableHasManyColumns", columnCount >= 7);
  block?.setAttribute("aria-label", `Bảng gồm ${rows.length} hàng và ${columnCount} cột. Chạm để nghe nội dung bảng.`);
  table.dataset.transferTablePolished = POLISH_VERSION;
  table.dataset.transferTableWidth = widthSignature;
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
    const resize = new ResizeObserver(schedule);
    document.querySelectorAll<HTMLElement>(".transferStructuredTable").forEach((table) => resize.observe(table));
    const tableObserver = new MutationObserver(() => {
      document.querySelectorAll<HTMLElement>(".transferStructuredTable").forEach((table) => resize.observe(table));
      schedule();
    });
    tableObserver.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(schedule, 1_500);
    return () => {
      observer.disconnect();
      tableObserver.disconnect();
      resize.disconnect();
      window.clearInterval(timer);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
