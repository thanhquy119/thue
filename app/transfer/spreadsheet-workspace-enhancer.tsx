"use client";

import * as XLSX from "@e965/xlsx";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import {
  SPREADSHEET_CONCLUSIONS,
  classifySpreadsheetConclusion,
  detectSpreadsheetHeaderRow,
  mapSpreadsheetHeaders,
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
  headerRow: number;
  dataStartRow: number;
  headers: string[];
  columns: number[];
  preamble: string[];
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

function analysisForSheet(worksheet: XLSX.WorkSheet): SheetAnalysis {
  const range = worksheet["!ref"] ? XLSX.utils.decode_range(worksheet["!ref"] as string) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const sampledRows: unknown[][] = [];
  for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + 39); row += 1) {
    const values: unknown[] = [];
    for (let column = range.s.c; column <= Math.min(range.e.c, range.s.c + MAX_VISIBLE_COLUMNS - 1); column += 1) {
      values.push(rawValue(cellObject(worksheet, row, column)));
    }
    sampledRows.push(values);
  }
  const headerRow = range.s.r + detectSpreadsheetHeaderRow(sampledRows);
  const endColumn = Math.min(range.e.c, range.s.c + MAX_VISIBLE_COLUMNS - 1);
  const columns = Array.from({ length: Math.max(1, endColumn - range.s.c + 1) }, (_, index) => range.s.c + index);
  const used = new Map<string, number>();
  const headers = columns.map((column) => {
    const raw = cellText(cellObject(worksheet, headerRow, column)).trim() || XLSX.utils.encode_col(column);
    const normalized = normalizeSpreadsheetHeader(raw) || `column-${column}`;
    const count = (used.get(normalized) ?? 0) + 1;
    used.set(normalized, count);
    return count === 1 ? raw : `${raw} (${count})`;
  });
  const preamble: string[] = [];
  for (let row = range.s.r; row < headerRow; row += 1) {
    const text = columns.map((column) => cellText(cellObject(worksheet, row, column))).filter(Boolean).join(" · ");
    if (text) preamble.push(text);
  }
  return { range, headerRow, dataStartRow: headerRow + 1, headers, columns, preamble };
}

function updateCalculationMode(workbook: XLSX.WorkBook) {
  const typed = workbook as XLSX.WorkBook & { Workbook?: { CalcPr?: Record<string, unknown> } };
  const container = (typed.Workbook ??= {});
  container.CalcPr = {
    calcMode: "auto",
    fullCalcOnLoad: true,
    forceFullCalc: true,
  };
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

function SpreadsheetWorkspace({ file, transferKey }: {
  file: SpreadsheetFile;
  transferKey: string;
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
  const appendInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setMessage("");
    setWorkbook(null);
    setHistory([]);
    void (async () => {
      try {
        const response = await fetch(`/api/transfer/files/${encodeURIComponent(file.id)}/source`, {
          headers: { "x-transfer-key": transferKey },
          cache: "no-store",
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(payload.error || "Không tải được bảng tính gốc.");
        }
        const buffer = await response.arrayBuffer();
        const parsed = XLSX.read(buffer, {
          type: "array",
          cellDates: true,
          cellFormula: true,
          cellStyles: true,
          cellNF: true,
          bookVBA: true,
          dense: false,
        });
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

  const worksheet = workbook && sheetName ? workbook.Sheets[sheetName] : undefined;
  const analysis = useMemo(() => worksheet ? analysisForSheet(worksheet) : null, [worksheet, sheetName, workbook]);

  useEffect(() => {
    if (!analysis) return;
    const [amountLeft, amountRight] = defaultColumnPair(analysis.headers, "amount");
    setLeftColumn(amountLeft);
    setRightColumn(amountRight);
    setScrollTop(0);
    setActiveCell(null);
  }, [analysis?.headerRow, sheetName]);

  const dataRowCount = analysis ? Math.max(0, analysis.range.e.r - analysis.dataStartRow + 1) : 0;
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
    setWorkbook({ ...next, Sheets: { ...next.Sheets } });
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
    const headerAddress = XLSX.utils.encode_cell({ r: analysis.headerRow, c: newColumn });
    const sourceHeader = cellObject(worksheet, analysis.headerRow, analysis.columns[0]);
    worksheet[headerAddress] = { t: "s", v: header, s: cloneStyle(sourceHeader) } as XLSX.CellObject;

    for (let row = analysis.dataStartRow; row <= analysis.range.e.r; row += 1) {
      const leftCell = cellObject(worksheet, row, left);
      const rightCell = cellObject(worksheet, row, right);
      const leftAddress = XLSX.utils.encode_cell({ r: row, c: left });
      const rightAddress = XLSX.utils.encode_cell({ r: row, c: right });
      const address = XLSX.utils.encode_cell({ r: row, c: newColumn });
      const leftValue = kind === "date" ? dateSerial(leftCell) : numericValue(leftCell);
      const rightValue = kind === "date" ? dateSerial(rightCell) : numericValue(rightCell);
      const formula = `IF(OR(${leftAddress}="",${rightAddress}=""),"",${rightAddress}-${leftAddress})`;
      if (leftValue == null || rightValue == null) {
        worksheet[address] = { t: "s", v: "", f: formula, s: cloneStyle(leftCell) } as XLSX.CellObject;
      } else {
        const difference = rightValue - leftValue;
        worksheet[address] = {
          t: "n",
          v: difference,
          f: formula,
          z: kind === "date" ? "0" : "#,##0;[Red]-#,##0",
          s: cloneStyle(leftCell),
        } as XLSX.CellObject;
      }
    }
    const nextRange = { ...analysis.range, e: { r: analysis.range.e.r, c: newColumn } };
    setWorksheetRange(worksheet, nextRange);
    refreshWorkbook(workbook, `Đã tạo cột “${header}” và gắn công thức cho ${dataRowCount.toLocaleString("vi-VN")} dòng.`);
  }, [analysis, dataRowCount, leftColumn, pushHistory, refreshWorkbook, rightColumn, workbook, worksheet]);

  const createConclusionColumn = useCallback(() => {
    if (!workbook || !worksheet || !analysis) return;
    const normalizedHeaders = analysis.headers.map(normalizeSpreadsheetHeader);
    const dateIndex = normalizedHeaders.findIndex((header) => header.includes("chenh lech ngay"));
    const amountIndex = normalizedHeaders.findIndex((header) => header.includes("chenh lech") && /tien|tong/u.test(header));
    if (dateIndex < 0 && amountIndex < 0) {
      setError("Chưa có cột chênh lệch. Hãy tạo chênh lệch ngày hoặc tiền trước.");
      return;
    }
    pushHistory();
    const newColumn = analysis.range.e.c + 1;
    const headerAddress = XLSX.utils.encode_cell({ r: analysis.headerRow, c: newColumn });
    worksheet[headerAddress] = {
      t: "s",
      v: "Kết luận đối chiếu",
      s: cloneStyle(cellObject(worksheet, analysis.headerRow, analysis.columns[0])),
    } as XLSX.CellObject;

    for (let row = analysis.dataStartRow; row <= analysis.range.e.r; row += 1) {
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
      worksheet[XLSX.utils.encode_cell({ r: row, c: newColumn })] = {
        t: "s",
        v: conclusion,
        f: formula,
        s: conclusionStyle(conclusion),
      } as XLSX.CellObject;
    }
    setWorksheetRange(worksheet, { ...analysis.range, e: { r: analysis.range.e.r, c: newColumn } });
    refreshWorkbook(workbook, "Đã tạo cột kết luận và tô màu các kết quả đối chiếu.");
  }, [analysis, pushHistory, refreshWorkbook, workbook, worksheet]);

  const colorConclusions = useCallback(() => {
    if (!workbook || !worksheet || !analysis) return;
    pushHistory();
    let colored = 0;
    for (let row = analysis.dataStartRow; row <= analysis.range.e.r; row += 1) {
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

  const applyCommand = useCallback(() => {
    const normalized = normalizeSpreadsheetHeader(command);
    if (/them|noi|ghep/u.test(normalized) && /du lieu|bang|file/u.test(normalized)) {
      appendInputRef.current?.click();
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
    setError("Chưa hiểu yêu cầu. Có thể dùng: chênh lệch ngày, chênh lệch tiền tổng, tạo kết luận, tô màu hoặc thêm dữ liệu.");
  }, [addDifferenceColumn, colorConclusions, command, createConclusionColumn]);

  const appendWorkbook = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const sourceFile = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!sourceFile || !workbook || !worksheet || !analysis) return;
    try {
      const sourceWorkbook = XLSX.read(await sourceFile.arrayBuffer(), {
        type: "array",
        cellDates: true,
        cellFormula: true,
        cellStyles: true,
        cellNF: true,
        bookVBA: true,
      });
      let best: { worksheet: XLSX.WorkSheet; analysis: SheetAnalysis; overlap: number } | null = null;
      for (const candidateName of sourceWorkbook.SheetNames) {
        const candidate = sourceWorkbook.Sheets[candidateName];
        if (!candidate) continue;
        const candidateAnalysis = analysisForSheet(candidate);
        const mapping = mapSpreadsheetHeaders(analysis.headers, candidateAnalysis.headers);
        const overlap = mapping.filter((index) => index >= 0).length;
        if (!best || overlap > best.overlap) best = { worksheet: candidate, analysis: candidateAnalysis, overlap };
      }
      if (!best || best.overlap < Math.max(2, Math.ceil(Math.min(analysis.headers.length, 8) * 0.4))) {
        throw new Error("File mới không có cấu trúc đủ giống bảng hiện tại để ghép an toàn.");
      }

      pushHistory();
      const mapping = mapSpreadsheetHeaders(analysis.headers, best.analysis.headers);
      const existingKeys = new Set<string>();
      for (let row = analysis.dataStartRow; row <= analysis.range.e.r; row += 1) {
        const values = analysis.columns.map((column) => rawValue(cellObject(worksheet, row, column)));
        const key = spreadsheetDuplicateKey(analysis.headers, values);
        if (key) existingKeys.add(key);
      }

      let targetRow = analysis.range.e.r + 1;
      let appended = 0;
      let duplicates = 0;
      for (let sourceRow = best.analysis.dataStartRow; sourceRow <= best.analysis.range.e.r; sourceRow += 1) {
        const alignedValues = analysis.headers.map((_header, targetIndex) => {
          const sourceIndex = mapping[targetIndex];
          if (sourceIndex < 0) return "";
          const sourceColumn = best!.analysis.columns[sourceIndex];
          return rawValue(cellObject(best!.worksheet, sourceRow, sourceColumn));
        });
        if (!alignedValues.some((value) => value != null && String(value).trim())) continue;
        const key = spreadsheetDuplicateKey(analysis.headers, alignedValues);
        if (key && existingKeys.has(key)) {
          duplicates += 1;
          continue;
        }
        if (key) existingKeys.add(key);

        for (let targetIndex = 0; targetIndex < analysis.columns.length; targetIndex += 1) {
          const targetColumn = analysis.columns[targetIndex];
          const sourceIndex = mapping[targetIndex];
          const targetAddress = XLSX.utils.encode_cell({ r: targetRow, c: targetColumn });
          if (sourceIndex >= 0) {
            const sourceColumn = best.analysis.columns[sourceIndex];
            const sourceCell = cellObject(best.worksheet, sourceRow, sourceColumn);
            if (sourceCell) worksheet[targetAddress] = structuredClone(sourceCell);
            continue;
          }
          const templateRow = Math.max(analysis.dataStartRow, targetRow - 1);
          const template = cellObject(worksheet, templateRow, targetColumn);
          if (!template) continue;
          const copied = structuredClone(template);
          if (copied.f) copied.f = shiftSpreadsheetFormula(copied.f, targetRow - templateRow);
          copied.v = copied.f ? "" : copied.v;
          worksheet[targetAddress] = copied;
        }
        targetRow += 1;
        appended += 1;
      }
      if (!appended) {
        setMessage(duplicates ? `Không thêm dòng mới; đã bỏ qua ${duplicates.toLocaleString("vi-VN")} hóa đơn trùng.` : "Không tìm thấy dòng dữ liệu mới để thêm.");
        return;
      }
      const nextRange = { ...analysis.range, e: { r: targetRow - 1, c: analysis.range.e.c } };
      setWorksheetRange(worksheet, nextRange);
      refreshWorkbook(
        workbook,
        `Đã thêm ${appended.toLocaleString("vi-VN")} dòng từ “${sourceFile.name}”${duplicates ? ` và bỏ qua ${duplicates.toLocaleString("vi-VN")} dòng trùng` : ""}.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Không thêm được dữ liệu.");
    }
  }, [analysis, pushHistory, refreshWorkbook, workbook, worksheet]);

  const undo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((current) => current.slice(0, -1));
    setWorkbook(previous);
    setMessage("Đã hoàn tác thao tác gần nhất.");
    setError("");
  }, [history]);

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

  const sheetMinWidth = 70 + analysis.columns.length * 156;
  const topSpacer = visibleStart * ROW_HEIGHT;
  const bottomSpacer = Math.max(0, (dataRowCount - visibleEnd) * ROW_HEIGHT);

  return (
    <section className="spreadsheetWorkspace" id="transfer-spreadsheet-workspace" aria-label={`Xử lý bảng tính ${file.name}`}>
      <header className="spreadsheetWorkspaceHeader">
        <div>
          <p className="sectionLabel">Không gian làm việc bảng tính</p>
          <h2>{file.name}</h2>
          <p>Xem, đối chiếu, thêm công thức, nối dữ liệu và xuất một bản Excel mới. File gốc luôn được giữ nguyên.</p>
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
          <span>Ví dụ: “Tạo cột chênh lệch tiền tổng”, “Tạo kết luận và tô màu”, hoặc “Thêm dữ liệu từ file khác”.</span>
        </div>
        <textarea value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Nhập yêu cầu xử lý bảng tính…" />
        <div className="spreadsheetColumnSelectors">
          <label><span>Cột gốc</span><select value={leftColumn} onChange={(event) => setLeftColumn(Number(event.target.value))}>{analysis.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header}</option>)}</select></label>
          <label><span>Cột đối chiếu</span><select value={rightColumn} onChange={(event) => setRightColumn(Number(event.target.value))}>{analysis.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header}</option>)}</select></label>
        </div>
        <div className="spreadsheetCommandActions">
          <button type="button" onClick={applyCommand}>Thực hiện yêu cầu</button>
          <button type="button" className="secondary" onClick={() => addDifferenceColumn("date")}>Chênh lệch ngày</button>
          <button type="button" className="secondary" onClick={() => addDifferenceColumn("amount")}>Chênh lệch tiền</button>
          <button type="button" className="secondary" onClick={createConclusionColumn}>Tạo kết luận</button>
          <button type="button" className="secondary" onClick={() => appendInputRef.current?.click()}>Thêm dữ liệu</button>
          <input ref={appendInputRef} type="file" accept=".xlsx,.xls,.xlsm,.xlsb,.xltx,.xltm,.ods,.csv,.tsv" onChange={(event) => void appendWorkbook(event)} />
        </div>
      </section>

      {error ? <p className="spreadsheetNotice error" role="alert">{error}</p> : null}
      {message ? <p className="spreadsheetNotice" role="status">{message}</p> : null}

      {analysis.preamble.length ? <div className="spreadsheetPreamble">{analysis.preamble.map((line) => <strong key={line}>{line}</strong>)}</div> : null}

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
    </section>
  );
}

export default function SpreadsheetWorkspaceEnhancer() {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [selected, setSelected] = useState<SpreadsheetFile | null>(null);
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
        const file = payload.files?.[index] ?? null;
        if (file?.extractionMethod === "spreadsheet") {
          setTransferKey(key);
          setSelected(file);
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
    <SpreadsheetWorkspace file={selected} transferKey={transferKey} />,
    portalTarget,
  );
}
