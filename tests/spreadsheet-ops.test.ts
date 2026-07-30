import assert from "node:assert/strict";
import test from "node:test";
import {
  SPREADSHEET_CONCLUSIONS,
  classifySpreadsheetConclusion,
  detectSpreadsheetHeaderRow,
  mapSpreadsheetHeaders,
  normalizeSpreadsheetHeader,
  shiftSpreadsheetFormula,
  spreadsheetDuplicateKey,
} from "../lib/transfer/spreadsheet-ops.ts";

test("normalizes Vietnamese spreadsheet headers", () => {
  assert.equal(normalizeSpreadsheetHeader("  Mã số thuế người bán  "), "ma so thue nguoi ban");
});

test("detects a header after title rows", () => {
  const rows = [
    ["Trang tính: HÓA ĐƠN tháng 06/2026"],
    [],
    ["STT", "Ngày lập", "MST người bán", "Tổng tiền"],
    [1, "01/06/2026", "0101", 100_000],
  ];
  assert.equal(detectSpreadsheetHeaderRow(rows), 2);
});

test("maps equivalent headers independent of accents and case", () => {
  assert.deepEqual(
    mapSpreadsheetHeaders(["Ngày lập", "MST người bán", "Kết luận"], ["mst NGƯỜI BÁN", "NGÀY LẬP"]),
    [1, 0, -1],
  );
});

test("shifts relative formula rows but keeps absolute rows", () => {
  assert.equal(shiftSpreadsheetFormula("IF(A7=$B$2,C7-D7,0)", 3), "IF(A10=$B$2,C10-D10,0)");
});

test("classifies reconciliation conclusions", () => {
  assert.equal(classifySpreadsheetConclusion(0, 0), SPREADSHEET_CONCLUSIONS.MATCH);
  assert.equal(classifySpreadsheetConclusion(2, 0), SPREADSHEET_CONCLUSIONS.DATE);
  assert.equal(classifySpreadsheetConclusion(0, 1500), SPREADSHEET_CONCLUSIONS.AMOUNT);
  assert.equal(classifySpreadsheetConclusion(-1, -20), SPREADSHEET_CONCLUSIONS.BOTH);
  assert.equal(classifySpreadsheetConclusion("", ""), SPREADSHEET_CONCLUSIONS.MISSING);
});

test("builds a duplicate invoice key from common columns", () => {
  const headers = ["MST người bán", "Ký hiệu hóa đơn", "Số hóa đơn", "Ngày lập"];
  assert.equal(
    spreadsheetDuplicateKey(headers, ["0100111948-044", "C24T", "000123", "23/06/2026"]),
    "0100111948 044|c24t|000123|23 06 2026",
  );
});
