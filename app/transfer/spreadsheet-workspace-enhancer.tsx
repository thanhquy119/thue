"use client";

import * as XLSX from "@e965/xlsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  SPREADSHEET_CONCLUSIONS,
  classifySpreadsheetConclusion,
  detectSpreadsheetTableLayout,
  findSpreadsheetSequenceColumn,
  mapSpreadsheetHeaders,
  nextSpreadsheetSequenceValue,
  normalizeSpreadsheetHeader,
  shiftSpreadsheetFormula,
  spreadsheetDuplicateKey,
} from "@/lib/transfer/spreadsheet-ops";

const STORAGE_KEY = "thue-transfer-key-v1";
const ROW_HEIGHT = 42;
const VIEWPORT_HEIGHT = 620;
const OVERSCAN = 10;
const MAX_VISIBLE_COLUMNS = 220;
const HISTORY_LIMIT = 8;
const LAYOUT_SCAN_ROWS = 80;
const DATA_SAMPLE_ROWS = 36;

const SPREADSHEET_ACCEPT = ".xlsx,.xls,.xlsm,.xlsb,.xltx,.xltm,.ods,.csv,.tsv";

type SpreadsheetFile = {
  id: string;
  name: string;
  size: number;
  contentType: string;
  extractionMethod: string | null;
  status: string;
  textPathname: string | null;
  createdAt?: string;
  warnings?: string[];
};

type TransferListPayload = { files?: SpreadsheetFile[] };
type ActiveCell = { row: number; column: number } | null;
type DifferenceKind = "date" | "amount";
type SheetAnalysis = {
  range: XLSX.Range;
  headerStartRow: number;
  headerEndRow: number;
  dataStartRow: number;
  dataEndRow: number;
  headers: string[];
  columns: number[];
  columnWidths: number[];
  preamble: string[];
};

type WorkbookCandidate = {
  name: string;
  worksheet: XLSX.WorkSheet;
  analysis: SheetAnalysis;
  overlap: number;
};

function currentTransferKey() {
  return window.localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
}

function workbookClone(workbook: XLSX.WorkBook) {
  return structuredClone(workbook);
}

function cellObject(worksheet: XLSX.WorkSheet, row: number, column: number) {
  return worksheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined;
}

function cellText(cell: XLSX.CellObject | undefined) {
  if (!cell) return "";
  if (typeof cell.w === "string" && cell.w) return cell.w;
  if (cell.v instanceof Date) return new Intl.DateTimeFormat("vi-VN").format(cell.v);
  return String(cell.v ?? "");
}

function rawValue(cell: XLSX.CellObject | undefined) {
  return cell?.v ?? "";
}

function meaningfulValue(value: unknown) {
  return value != null && String(value).trim() !== "";
}

function numericValue(cell: XLSX.CellObject | undefined) {
  if (!cell || cell.v == null || cell.v === "") return null;
  if (typeof cell.v === "number") return Number.isFinite(cell.v) ? cell.v : null;
  const raw = String(cell.v).trim().replace(/[^0-9,.-]/gu, "");
  if (!raw) return null;
  let normalized = raw;
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = Math.max(comma, dot);
    normalized = `${raw.slice(0, decimal).replace(/[.,]/gu, "")}.${raw.slice(decimal + 1)}`;
  } else if ((raw.match(/[.,]/gu) ?? []).length > 1 || /[.,]\d{3}$/u.test(raw)) {
    normalized = raw.replace(/[.,]/gu, "");
  } else {
    normalized = raw.replace(",", ".");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateSerial(cell: XLSX.CellObject | undefined) {
  if (!cell || cell.v == null || cell.v === "") return null;
  if (cell.v instanceof Date) return Date.UTC(cell.v.getFullYear(), cell.v.getMonth(), cell.v.getDate()) / 86_400_000;
  if (typeof cell.v === "number") return cell.v;
  const text = String(cell.v).trim();
  const vietnamese = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/u);
  if (vietnamese) {
    return Date.UTC(Number(vietnamese[3]), Number(vietnamese[2]) - 1, Number(vietnamese[1])) / 86_400_000;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed / 86_400_000 : null;
}

function cloneStyle(cell: XLSX.CellObject | undefined) {
  return cell?.s ? structuredClone(cell.s) : undefined;
}

function conclusionStyle(value: string) {
  const normalized = normalizeSpreadsheetHeader(value);
  if (normalized === normalizeSpreadsheetHeader(SPREADSHEET_CONCLUSIONS.MATCH)) {
    return { fill: { patternType: "solid", fgColor: { rgb: "DFF3E4" } }, font: { color: { rgb: "146C3B" }, bold: true } };
  }
  if (normalized === normalizeSpreadsheetHeader(SPREADSHEET_CONCLUSIONS.MISSING)) {
    return { fill: { patternType: "solid", fgColor: { rgb: "FFF2CC" } }, font: { color: { rgb: "7A5800" }, bold: true } };
  }
  return { fill: { patternType: "solid", fgColor: { rgb: "FCE1DE" } }, font: { color: { rgb: "9B2C24" }, bold: true } };
}

function setWorksheetRange(worksheet: XLSX.WorkSheet, range: XLSX.Range) {
  worksheet["!ref"] = XLSX.utils.encode_range(range);
}

function coordinateKey(row: number, column: number) {
  return `${row}:${column}`;
}

function worksheetMerges(worksheet: XLSX.WorkSheet) {
  return ((worksheet["!merges"] ?? []) as XLSX.Range[]).map((merge) => structuredClone(merge));
}

function buildMergeLookup(worksheet: XLSX.WorkSheet) {
  const lookup = new Map<string, XLSX.Range>();
  for (const merge of worksheetMerges(worksheet)) {
    for (let row = merge.s.r; row <= merge.e.r; row += 1) {
      for (let column = merge.s.c; column <= merge.e.c; column += 1) {
        lookup.set(coordinateKey(row, column), merge);
      }
    }
  }
  return lookup;
}

function mergedCellText(
  worksheet: XLSX.WorkSheet,
  row: number,
  column: number,
  mergeLookup: Map<string, XLSX.Range>,
) {
  const merge = mergeLookup.get(coordinateKey(row, column));
  const targetRow = merge?.s.r ?? row;
  const targetColumn = merge?.s.c ?? column;
  return cellText(cellObject(worksheet, targetRow, targetColumn));
}

function isMergeContinuation(row: number, column: number, mergeLookup: Map<string, XLSX.Range>) {
  const merge = mergeLookup.get(coordinateKey(row, column));
  return Boolean(merge && (merge.s.r !== row || merge.s.c !== column));
}

function columnPixelWidth(worksheet: XLSX.WorkSheet, startColumn: number, endColumn: number) {
  const columns = (worksheet["!cols"] ?? []) as Array<{ hidden?: boolean; wpx?: number; wch?: number; width?: number }>;
  let total = 0;
  let hasDeclaredWidth = false;
  for (let column = startColumn; column <= endColumn; column += 1) {
    const info = columns[column];
    if (!info || info.hidden) continue;
    const pixels = typeof info.wpx === "number"
      ? info.wpx
      : typeof info.wch === "number"
        ? info.wch * 7.2 + 12
        : typeof info.width === "number"
          ? info.width * 7.2 + 12
          : 0;
    if (pixels > 0) {
      total += pixels;
      hasDeclaredWidth = true;
    }
  }
  return hasDeclaredWidth ? total : 0;
}

function estimatedColumnWidth(worksheet: XLSX.WorkSheet, header: string, column: number, analysisRows: number[]) {
  let longest = header.length;
  for (const row of analysisRows) longest = Math.max(longest, cellText(cellObject(worksheet, row, column)).length);
  return Math.max(92, Math.min(320, longest * 7.1 + 28));
}

function expandedRowsForDetection(
  worksheet: XLSX.WorkSheet,
  range: XLSX.Range,
  mergeLookup: Map<string, XLSX.Range>,
) {
  const rows: unknown[][] = [];
  const endRow = Math.min(range.e.r, range.s.r + LAYOUT_SCAN_ROWS - 1);
  const endColumn = Math.min(range.e.c, range.s.c + MAX_VISIBLE_COLUMNS - 1);
  for (let row = range.s.r; row <= endRow; row += 1) {
    const values: unknown[] = [];
    for (let column = range.s.c; column <= endColumn; column += 1) {
      const text = mergedCellText(worksheet, row, column, mergeLookup);
      values.push(text || rawValue(cellObject(worksheet, row, column)));
    }
    rows.push(values);
  }
  return rows;
}

function analysisForSheet(worksheet: XLSX.WorkSheet): SheetAnalysis {
  const range = worksheet["!ref"]
    ? XLSX.utils.decode_range(worksheet["!ref"] as string)
    : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const mergeLookup = buildMergeLookup(worksheet);
  const sampledRows = expandedRowsForDetection(worksheet, range, mergeLookup);
  const layout = detectSpreadsheetTableLayout(sampledRows, LAYOUT_SCAN_ROWS);
  const headerStartRow = Math.min(range.e.r, range.s.r + layout.headerStart);
  const headerEndRow = Math.min(range.e.r, range.s.r + layout.headerEnd);
  const dataStartRow = Math.min(range.e.r + 1, range.s.r + layout.dataStart);
  const endColumn = Math.min(range.e.c, range.s.c + MAX_VISIBLE_COLUMNS - 1);
  const sampledDataEnd = Math.min(range.e.r, dataStartRow + DATA_SAMPLE_ROWS - 1);
  const dataSampleRows = dataStartRow <= sampledDataEnd
    ? Array.from({ length: sampledDataEnd - dataStartRow + 1 }, (_, index) => dataStartRow + index)
    : [];

  const logicalColumns: number[] = [];
  for (let column = range.s.c; column <= endColumn; column += 1) {
    let continuationCount = 0;
    for (const row of dataSampleRows) {
      if (isMergeContinuation(row, column, mergeLookup)) continuationCount += 1;
    }
    const structuralContinuation = dataSampleRows.length > 0 && continuationCount / dataSampleRows.length >= 0.6;
    if (structuralContinuation) continue;
    const headerHasValue = Array.from({ length: Math.max(1, headerEndRow - headerStartRow + 1) }, (_, index) => headerStartRow + index)
      .some((row) => meaningfulValue(mergedCellText(worksheet, row, column, mergeLookup)));
    const dataHasValue = dataSampleRows.some((row) => meaningfulValue(rawValue(cellObject(worksheet, row, column))));
    if (headerHasValue || dataHasValue) logicalColumns.push(column);
  }
  if (!logicalColumns.length) logicalColumns.push(range.s.c);

  const used = new Map<string, number>();
  const headers = logicalColumns.map((column) => {
    const parts: string[] = [];
    for (let row = headerStartRow; row <= headerEndRow; row += 1) {
      const value = mergedCellText(worksheet, row, column, mergeLookup).trim();
      if (value && !parts.some((part) => normalizeSpreadsheetHeader(part) === normalizeSpreadsheetHeader(value))) parts.push(value);
    }
    const raw = parts.join(" · ") || XLSX.utils.encode_col(column);
    const normalized = normalizeSpreadsheetHeader(raw) || `column-${column}`;
    const count = (used.get(normalized) ?? 0) + 1;
    used.set(normalized, count);
    return count === 1 ? raw : `${raw} (${count})`;
  });

  let dataEndRow = range.e.r;
  while (dataEndRow >= dataStartRow) {
    const meaningful = logicalColumns.some((column) => {
      const cell = cellObject(worksheet, dataEndRow, column);
      return meaningfulValue(cell?.v) || Boolean(cell?.f);
    });
    if (meaningful) break;
    dataEndRow -= 1;
  }
  if (dataEndRow < dataStartRow) dataEndRow = dataStartRow - 1;

  const preamble: string[] = [];
  for (let row = range.s.r; row < headerStartRow; row += 1) {
    const parts: string[] = [];
    for (const column of logicalColumns) {
      const value = mergedCellText(worksheet, row, column, mergeLookup).trim();
      if (value && !parts.includes(value)) parts.push(value);
    }
    const text = parts.join(" · ");
    if (text) preamble.push(text);
  }

  const columnWidths = logicalColumns.map((column, index) => {
    const nextColumn = logicalColumns[index + 1] ?? endColumn + 1;
    const declared = columnPixelWidth(worksheet, column, Math.max(column, nextColumn - 1));
    const estimated = estimatedColumnWidth(worksheet, headers[index], column, dataSampleRows.slice(0, 20));
    return Math.round(Math.max(92, Math.min(340, Math.max(declared, estimated))));
  });

  return {
    range,
    headerStartRow,
    headerEndRow,
    dataStartRow,
    dataEndRow,
    headers,
    columns: logicalColumns,
    columnWidths,
    preamble,
  };
}

function updateCalculationMode(workbook: XLSX.WorkBook) {
  const typed = workbook as XLSX.WorkBook & { Workbook?: { CalcPr?: Record<string, unknown> } };
  const container = (typed.Workbook ??= {});
  container.CalcPr = { calcMode: "auto", fullCalcOnLoad: true, forceFullCalc: true };
}

function defaultColumnPair(headers: string[], kind: DifferenceKind) {
  const normalized = headers.map(normalizeSpreadsheetHeader);
  const patterns = kind === "date"
    ? [/ngay hoa don/u, /ngay lap/u, /ngay ke khai/u, /ngay hach toan/u]
    : [/tong tien thanh toan/u, /tong cong/u, /tong tien/u, /thanh tien/u, /tien thanh toan/u];
  const candidates = normalized
    .map((header, index) => patterns.some((pattern) => pattern.test(header)) ? index : -1)
    .filter((index) => index >= 0);
  return [candidates[0] ?? 0, candidates[1] ?? Math.min(1, Math.max(0, headers.length - 1))] as const;
}

function spreadsheetExtension(filename: string) {
  return filename.toLocaleLowerCase("en").endsWith(".xlsm") ? "xlsm" : "xlsx";
}

function outputFilename(filename: string) {
  const stem = filename.replace(/\.[^.]+$/u, "") || "bang-tinh";
  return `${stem}-da-xu-ly.${spreadsheetExtension(filename)}`;
}

function parseWorkbook(buffer: ArrayBuffer) {
  return XLSX.read(buffer, {
    type: "array",
    cellDates: true,
    cellFormula: true,
    cellStyles: true,
    cellNF: true,
    bookVBA: true,
    dense: false,
  });
}

async function fetchTransferredWorkbook(fileId: string, transferKey: string) {
  const response = await fetch(`/api/transfer/files/${encodeURIComponent(fileId)}/source`, {
    headers: { "x-transfer-key": transferKey },
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || "Không tải được bảng tính gốc.");
  }
  return parseWorkbook(await response.arrayBuffer());
}

function safeSheetName(value: string) {
  return value.replace(/[\\/?*\[\]:]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 31) || "Trang tính";
}

function uniqueSheetName(workbook: XLSX.WorkBook, desired: string, reserved = new Set<string>()) {
  const base = safeSheetName(desired);
  const occupied = new Set([...workbook.SheetNames, ...reserved].map((name) => name.toLocaleLowerCase("vi")));
  if (!occupied.has(base.toLocaleLowerCase("vi"))) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const suffix = ` (${index})`;
    const candidate = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    if (!occupied.has(candidate.toLocaleLowerCase("vi"))) return candidate;
  }
  return safeSheetName(`${base}-${Date.now()}`);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function rewriteSheetReferences(formula: string, names: Map<string, string>) {
  let next = formula;
  for (const [oldName, newName] of names) {
    if (oldName === newName) continue;
    const oldQuoted = oldName.replace(/'/gu, "''");
    const newQuoted = newName.replace(/'/gu, "''");
    next = next.replace(new RegExp(`'${escapeRegExp(oldQuoted)}'!`, "gu"), `'${newQuoted}'!`);
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/u.test(oldName)) {
      next = next.replace(new RegExp(`\\b${escapeRegExp(oldName)}!`, "gu"), `${newName}!`);
    }
  }
  return next;
}

function importWorkbookSheets(target: XLSX.WorkBook, source: XLSX.WorkBook) {
  const reserved = new Set<string>();
  const names = new Map<string, string>();
  for (const oldName of source.SheetNames) {
    const newName = uniqueSheetName(target, oldName, reserved);
    reserved.add(newName);
    names.set(oldName, newName);
  }
  const imported: string[] = [];
  for (const oldName of source.SheetNames) {
    const sourceSheet = source.Sheets[oldName];
    if (!sourceSheet) continue;
    const newName = names.get(oldName) ?? oldName;
    const cloned = structuredClone(sourceSheet);
    for (const [address, candidate] of Object.entries(cloned)) {
      if (address.startsWith("!") || !candidate || typeof candidate !== "object") continue;
      const cell = candidate as XLSX.CellObject;
      if (cell.f) cell.f = rewriteSheetReferences(cell.f, names);
    }
    target.SheetNames.push(newName);
    target.Sheets[newName] = cloned;
    imported.push(newName);
  }
  return imported;
}

function findBestSourceSheet(sourceWorkbook: XLSX.WorkBook, targetAnalysis: SheetAnalysis) {
  let best: WorkbookCandidate | null = null;
  for (const candidateName of sourceWorkbook.SheetNames) {
    const candidate = sourceWorkbook.Sheets[candidateName];
    if (!candidate) continue;
    const candidateAnalysis = analysisForSheet(candidate);
    const mapping = mapSpreadsheetHeaders(targetAnalysis.headers, candidateAnalysis.headers);
    const overlap = mapping.filter((index) => index >= 0).length;
    if (!best || overlap > best.overlap) best = { name: candidateName, worksheet: candidate, analysis: candidateAnalysis, overlap };
  }
  return best;
}

function copyTemplateRowStructure(worksheet: XLSX.WorkSheet, templateRow: number, targetRow: number) {
  const rows = (worksheet["!rows"] ??= []) as Array<Record<string, unknown> | undefined>;
  if (rows[templateRow]) rows[targetRow] = structuredClone(rows[templateRow]);
  const merges = worksheetMerges(worksheet);
  const existing = new Set(merges.map((merge) => XLSX.utils.encode_range(merge)));
  const delta = targetRow - templateRow;
  const additions = merges
    .filter((merge) => merge.s.r === templateRow && merge.e.r === templateRow)
    .map((merge) => ({ s: { r: merge.s.r + delta, c: merge.s.c }, e: { r: merge.e.r + delta, c: merge.e.c } }))
    .filter((merge) => !existing.has(XLSX.utils.encode_range(merge)));
  if (additions.length) worksheet["!merges"] = [...merges, ...additions];
}

function SpreadsheetWorkspace({ file, transferKey, companionFiles }: {
  file: SpreadsheetFile;
  transferKey: string;
  companionFiles: SpreadsheetFile[];
}) {
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [activeCell, setActiveCell] = useState<ActiveCell>(null);
  const [formulaDraft, setFormulaDraft] = useState("");
  const [command, setCommand] = useState("");
  const [leftColumn, setLeftColumn] = useState(0);
  const [rightColumn, setRightColumn] = useState(1);
  const [history, setHistory] = useState<XLSX.WorkBook[]>([]);
  const [companionFileId, setCompanionFileId] = useState("");
  const appendInputRef = useRef<HTMLInputElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setMessage("");
    setWorkbook(null);
    setHistory([]);
    void (async () => {
      try {
        const parsed = await fetchTransferredWorkbook(file.id, transferKey);
        if (!parsed.SheetNames.length) throw new Error("Bảng tính không có trang tính nào.");
        if (cancelled) return;
        setWorkbook(parsed);
        setSheetName(parsed.SheetNames[0]);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Không mở được bảng tính.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file.id, transferKey]);

  useEffect(() => {
    if (companionFileId && companionFiles.some((candidate) => candidate.id === companionFileId)) return;
    setCompanionFileId(companionFiles[0]?.id ?? "");
  }, [companionFileId, companionFiles]);

  const worksheet = workbook && sheetName ? workbook.Sheets[sheetName] : undefined;
  const analysis = useMemo(() => worksheet ? analysisForSheet(worksheet) : null, [worksheet, sheetName, workbook]);

  useEffect(() => {
    if (!analysis) return;
    const [amountLeft, amountRight] = defaultColumnPair(analysis.headers, "amount");
    setLeftColumn(amountLeft);
    setRightColumn(amountRight);
    setScrollTop(0);
    setActiveCell(null);
  }, [analysis?.headerStartRow, analysis?.headerEndRow, sheetName]);

  const dataRowCount = analysis ? Math.max(0, analysis.dataEndRow - analysis.dataStartRow + 1) : 0;
  const visibleStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2;
  const visibleEnd = Math.min(dataRowCount, visibleStart + visibleCount);
  const visibleRows = analysis
    ? Array.from({ length: Math.max(0, visibleEnd - visibleStart) }, (_, index) => analysis.dataStartRow + visibleStart + index)
    : [];
  const activeCellObject = activeCell && worksheet ? cellObject(worksheet, activeCell.row, activeCell.column) : undefined;
  const activeAddress = activeCell ? XLSX.utils.encode_cell({ r: activeCell.row, c: activeCell.column }) : "";

  const pushHistory = useCallback(() => {
    if (!workbook) return;
    setHistory((current) => [...current.slice(-(HISTORY_LIMIT - 1)), workbookClone(workbook)]);
  }, [workbook]);

  const refreshWorkbook = useCallback((next: XLSX.WorkBook, nextMessage: string) => {
    updateCalculationMode(next);
    setWorkbook({ ...next, SheetNames: [...next.SheetNames], Sheets: { ...next.Sheets } });
    setMessage(nextMessage);
    setError("");
  }, []);

  const chooseCell = useCallback((row: number, column: number) => {
    setActiveCell({ row, column });
    const cell = worksheet ? cellObject(worksheet, row, column) : undefined;
    setFormulaDraft(cell?.f ? `=${cell.f}` : cellText(cell));
  }, [worksheet]);

  const saveFormulaBar = useCallback(() => {
    if (!workbook || !worksheet || !activeCell || !analysis) return;
    pushHistory();
    const address = XLSX.utils.encode_cell({ r: activeCell.row, c: activeCell.column });
    const previous = worksheet[address] as XLSX.CellObject | undefined;
    const style = cloneStyle(previous);
    const value = formulaDraft.trim();
    if (value.startsWith("=")) {
      worksheet[address] = { t: "n", f: value.slice(1), v: typeof previous?.v === "number" ? previous.v : 0, s: style } as XLSX.CellObject;
    } else if (!value) {
      delete worksheet[address];
    } else {
      const numeric = Number(value.replace(/\s/gu, "").replace(/,/gu, "."));
      worksheet[address] = Number.isFinite(numeric)
        ? { t: "n", v: numeric, s: style } as XLSX.CellObject
        : { t: "s", v: value, s: style } as XLSX.CellObject;
    }
    const nextRange = { ...analysis.range, e: { ...analysis.range.e } };
    nextRange.e.r = Math.max(nextRange.e.r, activeCell.row);
    nextRange.e.c = Math.max(nextRange.e.c, activeCell.column);
    setWorksheetRange(worksheet, nextRange);
    refreshWorkbook(workbook, `Đã cập nhật ô ${address}.`);
  }, [activeCell, analysis, formulaDraft, pushHistory, refreshWorkbook, workbook, worksheet]);

  const addDifferenceColumn = useCallback((kind: DifferenceKind) => {
    if (!workbook || !worksheet || !analysis) return;
    const left = analysis.columns[leftColumn];
    const right = analysis.columns[rightColumn];
    if (left == null || right == null || left === right) {
      setError("Hãy chọn hai cột khác nhau để đối chiếu.");
      return;
    }
    pushHistory();
    const newColumn = analysis.range.e.c + 1;
    const header = kind === "date" ? "Chênh lệch ngày kê khai" : "Chênh lệch tiền tổng";
    const headerAddress = XLSX.utils.encode_cell({ r: analysis.headerEndRow, c: newColumn });
    const sourceHeader = cellObject(worksheet, analysis.headerEndRow, analysis.columns[0]);
    worksheet[headerAddress] = { t: "s", v: header, s: cloneStyle(sourceHeader) } as XLSX.CellObject;
    for (let row = analysis.dataStartRow; row <= analysis.dataEndRow; row += 1) {
      const leftCell = cellObject(worksheet, row, left);
      const rightCell = cellObject(worksheet, row, right);
      const leftAddress = XLSX.utils.encode_cell({ r: row, c: left });
      const rightAddress = XLSX.utils.encode_cell({ r: row, c: right });
      const address = XLSX.utils.encode_cell({ r: row, c: newColumn });
      const leftValue = kind === "date" ? dateSerial(leftCell) : numericValue(leftCell);
      const rightValue = kind === "date" ? dateSerial(rightCell) : numericValue(rightCell);
      const formula = `IF(OR(${leftAddress}="",${rightAddress}=""),"",${rightAddress}-${leftAddress})`;
      worksheet[address] = leftValue == null || rightValue == null
        ? { t: "s", v: "", f: formula, s: cloneStyle(leftCell) } as XLSX.CellObject
        : {
          t: "n",
          v: rightValue - leftValue,
          f: formula,
          z: kind === "date" ? "0" : "#,##0;[Red]-#,##0",
          s: cloneStyle(leftCell),
        } as XLSX.CellObject;
    }
    setWorksheetRange(worksheet, { ...analysis.range, e: { r: Math.max(analysis.range.e.r, analysis.dataEndRow), c: newColumn } });
    refreshWorkbook(workbook, `Đã tạo cột “${header}” và gắn công thức cho ${dataRowCount.toLocaleString("vi-VN")} dòng.`);
  }, [analysis, dataRowCount, leftColumn, pushHistory, refreshWorkbook, rightColumn, workbook, worksheet]);

  const createConclusionColumn = useCallback(() => {
    if (!workbook || !worksheet || !analysis) return;
    const normalizedHeaders = analysis.headers.map(normalizeSpreadsheetHeader);
    const dateIndex = normalizedHeaders.findIndex((header) => header.includes("chenh lech ngay"));
    const amountIndex = normalizedHeaders.findIndex((header) => header.includes("chenh lech") && /tien|tong/u.test(header));
    if (dateIndex < 0 && amountIndex < 0) {
      setError("Chưa có dữ liệu chênh lệch để tạo kết luận.");
      return;
    }
    pushHistory();
    const newColumn = analysis.range.e.c + 1;
    worksheet[XLSX.utils.encode_cell({ r: analysis.headerEndRow, c: newColumn })] = {
      t: "s",
      v: "Kết luận đối chiếu",
      s: cloneStyle(cellObject(worksheet, analysis.headerEndRow, analysis.columns[0])),
    } as XLSX.CellObject;
    for (let row = analysis.dataStartRow; row <= analysis.dataEndRow; row += 1) {
      const dateColumn = dateIndex >= 0 ? analysis.columns[dateIndex] : null;
      const amountColumn = amountIndex >= 0 ? analysis.columns[amountIndex] : null;
      const dateCell = dateColumn == null ? undefined : cellObject(worksheet, row, dateColumn);
      const amountCell = amountColumn == null ? undefined : cellObject(worksheet, row, amountColumn);
      const dateAddress = dateColumn == null ? null : XLSX.utils.encode_cell({ r: row, c: dateColumn });
      const amountAddress = amountColumn == null ? null : XLSX.utils.encode_cell({ r: row, c: amountColumn });
      const conclusion = classifySpreadsheetConclusion(rawValue(dateCell), rawValue(amountCell));
      const dateExpression = dateAddress ? `ABS(${dateAddress})>0` : "FALSE";
      const amountExpression = amountAddress ? `ABS(${amountAddress})>0.5` : "FALSE";
      const blankExpression = [dateAddress, amountAddress].filter(Boolean).map((address) => `${address}=""`).join(",");
      const formula = `IF(AND(${blankExpression || "TRUE"}),"${SPREADSHEET_CONCLUSIONS.MISSING}",IF(AND(${dateExpression},${amountExpression}),"${SPREADSHEET_CONCLUSIONS.BOTH}",IF(${dateExpression},"${SPREADSHEET_CONCLUSIONS.DATE}",IF(${amountExpression},"${SPREADSHEET_CONCLUSIONS.AMOUNT}","${SPREADSHEET_CONCLUSIONS.MATCH}"))))`;
      worksheet[XLSX.utils.encode_cell({ r: row, c: newColumn })] = { t: "s", v: conclusion, f: formula, s: conclusionStyle(conclusion) } as XLSX.CellObject;
    }
    setWorksheetRange(worksheet, { ...analysis.range, e: { r: Math.max(analysis.range.e.r, analysis.dataEndRow), c: newColumn } });
    refreshWorkbook(workbook, "Đã tạo cột kết luận và tô màu các kết quả đối chiếu.");
  }, [analysis, pushHistory, refreshWorkbook, workbook, worksheet]);

  const colorConclusions = useCallback(() => {
    if (!workbook || !worksheet || !analysis) return;
    pushHistory();
    let colored = 0;
    for (let row = analysis.dataStartRow; row <= analysis.dataEndRow; row += 1) {
      for (const column of analysis.columns) {
        const address = XLSX.utils.encode_cell({ r: row, c: column });
        const cell = worksheet[address] as XLSX.CellObject | undefined;
        const value = cellText(cell);
        if (!Object.values(SPREADSHEET_CONCLUSIONS).includes(value as never)) continue;
        worksheet[address] = { ...cell, s: conclusionStyle(value) } as XLSX.CellObject;
        colored += 1;
      }
    }
    refreshWorkbook(workbook, `Đã tô màu ${colored.toLocaleString("vi-VN")} kết luận.`);
  }, [analysis, pushHistory, refreshWorkbook, workbook, worksheet]);

  const scrollToDataSources = useCallback(() => {
    document.getElementById("spreadsheet-data-sources")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const applyCommand = useCallback(() => {
    const normalized = normalizeSpreadsheetHeader(command);
    if (!normalized) {
      setError("Hãy nhập yêu cầu cần xử lý.");
      return;
    }
    if (/them|noi|ghep|dua/u.test(normalized) && /du lieu|bang|file|sheet|trang tinh/u.test(normalized)) {
      scrollToDataSources();
      return;
    }
    if (/ket luan|phan loai|danh dau/u.test(normalized)) {
      createConclusionColumn();
      return;
    }
    if (/to mau|mau ket qua/u.test(normalized)) {
      colorConclusions();
      return;
    }
    if (/chenh lech ngay|lech ngay/u.test(normalized)) {
      addDifferenceColumn("date");
      return;
    }
    if (/chenh lech tien|lech tien|chenh tien|tong tien/u.test(normalized)) {
      addDifferenceColumn("amount");
      return;
    }
    setError("Chưa xác định được thao tác. Hãy mô tả rõ cột cần tạo hoặc chọn nguồn dữ liệu ở phần bên dưới.");
  }, [addDifferenceColumn, colorConclusions, command, createConclusionColumn, scrollToDataSources]);

  const appendSourceWorkbook = useCallback((sourceWorkbook: XLSX.WorkBook, sourceLabel: string) => {
    if (!workbook || !worksheet || !analysis) return;
    const best = findBestSourceSheet(sourceWorkbook, analysis);
    if (!best || best.overlap < Math.max(2, Math.ceil(Math.min(analysis.headers.length, 8) * 0.4))) {
      throw new Error("File phụ không có cấu trúc đủ giống sheet hiện tại để nối dòng an toàn.");
    }
    pushHistory();
    const mapping = mapSpreadsheetHeaders(analysis.headers, best.analysis.headers);
    const existingKeys = new Set<string>();
    const existingRows: unknown[][] = [];
    for (let row = analysis.dataStartRow; row <= analysis.dataEndRow; row += 1) {
      const values = analysis.columns.map((column) => rawValue(cellObject(worksheet, row, column)));
      existingRows.push(values);
      const key = spreadsheetDuplicateKey(analysis.headers, values);
      if (key) existingKeys.add(key);
    }
    const sequenceIndex = findSpreadsheetSequenceColumn(analysis.headers);
    let nextSequence = nextSpreadsheetSequenceValue(existingRows, sequenceIndex);
    let targetRow = Math.max(analysis.dataStartRow, analysis.dataEndRow + 1);
    let appended = 0;
    let duplicates = 0;
    for (let sourceRow = best.analysis.dataStartRow; sourceRow <= best.analysis.dataEndRow; sourceRow += 1) {
      const alignedValues = analysis.headers.map((_header, targetIndex) => {
        const sourceIndex = mapping[targetIndex];
        if (sourceIndex < 0) return "";
        const sourceColumn = best.analysis.columns[sourceIndex];
        return rawValue(cellObject(best.worksheet, sourceRow, sourceColumn));
      });
      if (!alignedValues.some(meaningfulValue)) continue;
      const key = spreadsheetDuplicateKey(analysis.headers, alignedValues);
      if (key && existingKeys.has(key)) {
        duplicates += 1;
        continue;
      }
      if (key) existingKeys.add(key);
      const templateRow = targetRow > analysis.dataStartRow ? targetRow - 1 : analysis.dataStartRow;
      copyTemplateRowStructure(worksheet, templateRow, targetRow);
      for (let targetIndex = 0; targetIndex < analysis.columns.length; targetIndex += 1) {
        const targetColumn = analysis.columns[targetIndex];
        const sourceIndex = mapping[targetIndex];
        const targetAddress = XLSX.utils.encode_cell({ r: targetRow, c: targetColumn });
        const template = cellObject(worksheet, templateRow, targetColumn);
        if (targetIndex === sequenceIndex) {
          const sourceCell = sourceIndex >= 0
            ? cellObject(best.worksheet, sourceRow, best.analysis.columns[sourceIndex])
            : undefined;
          worksheet[targetAddress] = {
            ...(sourceCell ? structuredClone(sourceCell) : template ? structuredClone(template) : {}),
            t: "n",
            v: nextSequence,
            f: undefined,
            w: undefined,
          } as XLSX.CellObject;
          nextSequence += 1;
          continue;
        }
        if (sourceIndex >= 0) {
          const sourceColumn = best.analysis.columns[sourceIndex];
          const sourceCell = cellObject(best.worksheet, sourceRow, sourceColumn);
          if (sourceCell) worksheet[targetAddress] = structuredClone(sourceCell);
          else if (template) worksheet[targetAddress] = { ...structuredClone(template), v: "", f: undefined, w: undefined } as XLSX.CellObject;
          continue;
        }
        if (!template) continue;
        const copied = structuredClone(template);
        if (copied.f) copied.f = shiftSpreadsheetFormula(copied.f, targetRow - templateRow);
        copied.v = copied.f ? "" : copied.v;
        copied.w = undefined;
        worksheet[targetAddress] = copied;
      }
      targetRow += 1;
      appended += 1;
    }
    if (!appended) {
      setMessage(duplicates
        ? `Không thêm dòng mới; đã bỏ qua ${duplicates.toLocaleString("vi-VN")} dòng trùng.`
        : "Không tìm thấy dòng dữ liệu mới để thêm.");
      return;
    }
    setWorksheetRange(worksheet, {
      ...analysis.range,
      e: { r: Math.max(analysis.range.e.r, targetRow - 1), c: analysis.range.e.c },
    });
    refreshWorkbook(
      workbook,
      `Đã thêm ${appended.toLocaleString("vi-VN")} dòng từ “${sourceLabel}”${sequenceIndex >= 0 ? "; số thứ tự đã được đánh tiếp" : ""}${duplicates ? ` và bỏ qua ${duplicates.toLocaleString("vi-VN")} dòng trùng` : ""}.`,
    );
  }, [analysis, pushHistory, refreshWorkbook, workbook, worksheet]);

  const importSourceWorkbook = useCallback((sourceWorkbook: XLSX.WorkBook, sourceLabel: string) => {
    if (!workbook) return;
    pushHistory();
    const imported = importWorkbookSheets(workbook, sourceWorkbook);
    if (!imported.length) throw new Error("File phụ không có sheet nào để thêm.");
    refreshWorkbook(workbook, `Đã đưa ${imported.length.toLocaleString("vi-VN")} sheet từ “${sourceLabel}” vào file chính.`);
    setSheetName(imported[0]);
  }, [pushHistory, refreshWorkbook, workbook]);

  const loadCompanionWorkbook = useCallback(async () => {
    const source = companionFiles.find((candidate) => candidate.id === companionFileId);
    if (!source) throw new Error("Hãy chọn một file phụ.");
    return { source, workbook: await fetchTransferredWorkbook(source.id, transferKey) };
  }, [companionFileId, companionFiles, transferKey]);

  const importCompanionAsSheets = useCallback(async () => {
    try {
      const loaded = await loadCompanionWorkbook();
      importSourceWorkbook(loaded.workbook, loaded.source.name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thêm được sheet từ file phụ.");
    }
  }, [importSourceWorkbook, loadCompanionWorkbook]);

  const appendCompanionRows = useCallback(async () => {
    try {
      const loaded = await loadCompanionWorkbook();
      appendSourceWorkbook(loaded.workbook, loaded.source.name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không nối được dữ liệu từ file phụ.");
    }
  }, [appendSourceWorkbook, loadCompanionWorkbook]);

  const handleLocalWorkbook = useCallback(async (
    event: ChangeEvent<HTMLInputElement>,
    mode: "sheet" | "append",
  ) => {
    const sourceFile = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!sourceFile) return;
    try {
      const sourceWorkbook = parseWorkbook(await sourceFile.arrayBuffer());
      if (mode === "sheet") importSourceWorkbook(sourceWorkbook, sourceFile.name);
      else appendSourceWorkbook(sourceWorkbook, sourceFile.name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không xử lý được file phụ.");
    }
  }, [appendSourceWorkbook, importSourceWorkbook]);

  const undo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((current) => current.slice(0, -1));
    setWorkbook(previous);
    if (!previous.SheetNames.includes(sheetName)) setSheetName(previous.SheetNames[0] ?? "");
    setMessage("Đã hoàn tác thao tác gần nhất.");
    setError("");
  }, [history, sheetName]);

  const exportWorkbook = useCallback(() => {
    if (!workbook) return;
    const extension = spreadsheetExtension(file.name);
    XLSX.writeFile(workbook, outputFilename(file.name), {
      bookType: extension,
      compression: true,
      cellStyles: true,
      bookVBA: extension === "xlsm",
    } as XLSX.WritingOptions);
    setMessage("Đã tạo file Excel mới, giữ nguyên file gốc trong hộp file.");
  }, [file.name, workbook]);

  const openOriginal = useCallback(async () => {
    const response = await fetch(`/api/transfer/files/${encodeURIComponent(file.id)}/source`, {
      headers: { "x-transfer-key": transferKey },
      cache: "no-store",
    });
    if (!response.ok) {
      setError("Không mở được file gốc.");
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [file.id, transferKey]);

  if (loading) {
    return <section className="spreadsheetWorkspace spreadsheetLoading" id="transfer-spreadsheet-workspace"><strong>Đang mở cấu trúc bảng tính…</strong></section>;
  }
  if (error && !workbook) {
    return <section className="spreadsheetWorkspace spreadsheetLoading" id="transfer-spreadsheet-workspace"><strong>{error}</strong></section>;
  }
  if (!workbook || !worksheet || !analysis) return null;

  const sheetMinWidth = 70 + analysis.columnWidths.reduce((sum, width) => sum + width, 0);
  const topSpacer = visibleStart * ROW_HEIGHT;
  const bottomSpacer = Math.max(0, (dataRowCount - visibleEnd) * ROW_HEIGHT);

  return (
    <section className="spreadsheetWorkspace" id="transfer-spreadsheet-workspace" aria-label={`Xử lý bảng tính ${file.name}`}>
      <header className="spreadsheetWorkspaceHeader">
        <div>
          <p className="sectionLabel">Không gian làm việc bảng tính</p>
          <h2>{file.name}</h2>
          <p>Xem, xử lý, ghép file và xuất một bản Excel mới. File gốc luôn được giữ nguyên.</p>
        </div>
        <div className="spreadsheetHeaderActions">
          <button type="button" className="secondary" onClick={() => void openOriginal()}>Mở file gốc</button>
          <button type="button" className="secondary" onClick={undo} disabled={!history.length}>Hoàn tác</button>
          <button type="button" onClick={exportWorkbook}>Tải Excel đã xử lý</button>
        </div>
      </header>

      <div className="spreadsheetSheetTabs" role="tablist" aria-label="Trang tính">
        {workbook.SheetNames.map((name) => (
          <button type="button" role="tab" aria-selected={name === sheetName} className={name === sheetName ? "active" : ""} key={name} onClick={() => setSheetName(name)}>{name}</button>
        ))}
      </div>

      <section className="spreadsheetCommandPanel" aria-label="Yêu cầu xử lý bảng tính">
        <div className="spreadsheetCommandCopy">
          <strong>Yêu cầu Thuế Rõ xử lý</strong>
          <span>Mô tả kết quả cần tạo; ứng dụng sẽ kiểm tra cấu trúc sheet trước khi thay đổi.</span>
        </div>
        <textarea value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Nhập yêu cầu xử lý bảng tính…" />
        <details className="spreadsheetColumnOptions">
          <summary>Chọn cột dùng khi đối chiếu</summary>
          <div className="spreadsheetColumnSelectors">
            <label><span>Cột gốc</span><select value={leftColumn} onChange={(event) => setLeftColumn(Number(event.target.value))}>{analysis.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header}</option>)}</select></label>
            <label><span>Cột đối chiếu</span><select value={rightColumn} onChange={(event) => setRightColumn(Number(event.target.value))}>{analysis.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header}</option>)}</select></label>
          </div>
        </details>
        <div className="spreadsheetCommandActions">
          <button type="button" onClick={applyCommand}>Thực hiện yêu cầu</button>
        </div>
      </section>

      {error ? <p className="spreadsheetNotice error" role="alert">{error}</p> : null}
      {message ? <p className="spreadsheetNotice" role="status">{message}</p> : null}
      {analysis.preamble.length ? <div className="spreadsheetPreamble">{analysis.preamble.map((line, index) => <strong key={`${line}-${index}`}>{line}</strong>)}</div> : null}

      <div className="spreadsheetFormulaBar">
        <span>{activeAddress || "Ô"}</span>
        <input
          value={formulaDraft}
          onChange={(event) => setFormulaDraft(event.target.value)}
          onBlur={saveFormulaBar}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveFormulaBar(); } }}
          placeholder="Chọn một ô để xem hoặc nhập giá trị/công thức"
          disabled={!activeCell}
        />
        {activeCellObject?.f ? <small>Công thức hiện tại</small> : null}
      </div>

      <div className="spreadsheetGridViewport" style={{ "--spreadsheet-min-width": `${sheetMinWidth}px` } as CSSProperties} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <table className="spreadsheetGrid">
          <colgroup>
            <col className="spreadsheetRowNumberColumn" />
            {analysis.columnWidths.map((width, index) => <col key={`${analysis.columns[index]}-${width}`} style={{ width, minWidth: width, maxWidth: width }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="spreadsheetRowNumber">#</th>
              {analysis.headers.map((header, index) => <th key={`${header}-${index}`} title={header}>{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {topSpacer ? <tr className="spreadsheetSpacer"><td colSpan={analysis.columns.length + 1} style={{ height: topSpacer }} /></tr> : null}
            {visibleRows.map((row) => (
              <tr key={row} style={{ height: ROW_HEIGHT }}>
                <th className="spreadsheetRowNumber" scope="row">{row + 1}</th>
                {analysis.columns.map((column) => {
                  const address = XLSX.utils.encode_cell({ r: row, c: column });
                  const value = cellText(cellObject(worksheet, row, column));
                  const selected = activeCell?.row === row && activeCell.column === column;
                  const conclusion = Object.values(SPREADSHEET_CONCLUSIONS).includes(value as never);
                  return (
                    <td key={column} className={`${selected ? "selected" : ""} ${conclusion ? `result-${normalizeSpreadsheetHeader(value).replace(/\s+/gu, "-")}` : ""}`}>
                      <button type="button" title={`${address}: ${value}`} onClick={() => chooseCell(row, column)}>{value}</button>
                    </td>
                  );
                })}
              </tr>
            ))}
            {bottomSpacer ? <tr className="spreadsheetSpacer"><td colSpan={analysis.columns.length + 1} style={{ height: bottomSpacer }} /></tr> : null}
          </tbody>
        </table>
      </div>
      <footer className="spreadsheetWorkspaceFooter">
        <span>{dataRowCount.toLocaleString("vi-VN")} dòng dữ liệu · {analysis.columns.length.toLocaleString("vi-VN")} cột</span>
        {analysis.range.e.c - analysis.range.s.c + 1 > MAX_VISIBLE_COLUMNS ? <span>Đang giới hạn {MAX_VISIBLE_COLUMNS} cột đầu để bảo đảm tốc độ.</span> : null}
      </footer>

      <section className="spreadsheetDataPanel" id="spreadsheet-data-sources" aria-label="Dữ liệu bổ sung">
        <div className="spreadsheetDataCopy">
          <p className="sectionLabel">Dữ liệu bổ sung</p>
          <h3>Đưa file phụ vào file chính hoặc nối thêm các dòng tương ứng</h3>
          <p>Khi nối dòng, hàng tiêu đề của file phụ được bỏ qua và cột số thứ tự sẽ tiếp tục từ giá trị lớn nhất hiện có.</p>
        </div>
        {companionFiles.length ? (
          <div className="spreadsheetCompanionRow">
            <label>
              <span>File đã có trong hộp</span>
              <select value={companionFileId} onChange={(event) => setCompanionFileId(event.target.value)}>
                {companionFiles.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void importCompanionAsSheets()}>Thêm thành sheet mới</button>
            <button type="button" className="secondary" onClick={() => void appendCompanionRows()}>Nối dòng vào sheet hiện tại</button>
          </div>
        ) : <p className="spreadsheetDataEmpty">Chưa có file bảng tính phụ trong hộp này.</p>}
        <div className="spreadsheetLocalActions">
          <button type="button" onClick={() => importInputRef.current?.click()}>Chọn file phụ để thêm thành sheet</button>
          <button type="button" className="secondary" onClick={() => appendInputRef.current?.click()}>Thêm dữ liệu vào sheet hiện tại</button>
          <input ref={importInputRef} type="file" accept={SPREADSHEET_ACCEPT} onChange={(event) => void handleLocalWorkbook(event, "sheet")} />
          <input ref={appendInputRef} type="file" accept={SPREADSHEET_ACCEPT} onChange={(event) => void handleLocalWorkbook(event, "append")} />
        </div>
      </section>
    </section>
  );
}

export default function SpreadsheetWorkspaceEnhancer() {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [selected, setSelected] = useState<SpreadsheetFile | null>(null);
  const [spreadsheetFiles, setSpreadsheetFiles] = useState<SpreadsheetFile[]>([]);
  const [transferKey, setTransferKey] = useState("");

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".transferShell");
    setPortalTarget(shell);
    return () => shell?.classList.remove("transferSpreadsheetMode");
  }, []);

  useEffect(() => {
    const selectByButton = async (button: HTMLButtonElement) => {
      const key = currentTransferKey();
      if (!key) return;
      const buttons = [...document.querySelectorAll<HTMLButtonElement>(".transferFileOpen")];
      const index = buttons.indexOf(button);
      if (index < 0) return;
      try {
        const response = await fetch("/api/transfer/files", { headers: { "x-transfer-key": key }, cache: "no-store" });
        const payload = await response.json().catch(() => ({})) as TransferListPayload;
        const files = payload.files ?? [];
        const chosen = files[index] ?? null;
        const spreadsheets = files.filter((candidate) => candidate.extractionMethod === "spreadsheet" && candidate.status === "ready");
        setSpreadsheetFiles(spreadsheets);
        if (chosen?.extractionMethod === "spreadsheet") {
          setTransferKey(key);
          setSelected(chosen);
          window.setTimeout(() => document.getElementById("transfer-spreadsheet-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
        } else {
          setSelected(null);
        }
      } catch {
        setSelected(null);
      }
    };
    const handleClick = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>(".transferFileOpen");
      if (button) void selectByButton(button);
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  useEffect(() => {
    portalTarget?.classList.toggle("transferSpreadsheetMode", Boolean(selected));
    if (!selected) return;
    window.speechSynthesis?.cancel();
  }, [portalTarget, selected]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!currentTransferKey()) setSelected(null);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!portalTarget || !selected || !transferKey) return null;
  return createPortal(
    <SpreadsheetWorkspace
      file={selected}
      transferKey={transferKey}
      companionFiles={spreadsheetFiles.filter((candidate) => candidate.id !== selected.id)}
    />,
    portalTarget,
  );
}
