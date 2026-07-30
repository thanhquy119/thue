import assert from "node:assert/strict";
import test from "node:test";
import {
  SPREADSHEET_CONCLUSIONS,
  classifySpreadsheetConclusion,
  detectSpreadsheetHeaderRow,
  detectSpreadsheetTableLayout,
  findSpreadsheetSequenceColumn,
  mapSpreadsheetHeaders,
  nextSpreadsheetSequenceValue,
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
    [2, "02/06/2026", "0102", 200_000],
    [3, "03/06/2026", "0103", 300_000],
  ];
  assert.equal(detectSpreadsheetHeaderRow(rows), 2);
  assert.deepEqual(detectSpreadsheetTableLayout(rows), {
    headerStart: 2,
    headerEnd: 2,
    dataStart: 3,
    confidence: 1,
  });
});

test("detects a two-row grouped header before dense data", () => {
  const rows = [
    ["", "", "Danh sách NNT sử dụng đất phi nông nghiệp cần rà soát thông tin", "Danh sách NNT sử dụng đất phi nông nghiệp cần rà soát thông tin", "Danh sách NNT sử dụng đất phi nông nghiệp cần rà soát thông tin"],
    ["STT", "STT", "Mã CQT", "Mã CQT", "Thông tin người nộp thuế", "Thông tin người nộp thuế", "Địa chỉ hiện tại"],
    ["STT", "STT", "Mã CQT", "Mã CQT", "Mã số thuế", "Họ và tên", "Tỉnh/Thành phố"],
    [1, 1, 82301, 82301, "8270777828", "Nguyễn Văn Định", "Cà Mau"],
    [2, 2, 82301, 82301, "8265890190", "Hồ Tuyết Nhung", "Cà Mau"],
    [3, 3, 82301, 82301, "8265890810", "Trương Tỷ", "Cà Mau"],
  ];
  const layout = detectSpreadsheetTableLayout(rows);
  assert.equal(layout.headerStart, 1);
  assert.equal(layout.headerEnd, 2);
  assert.equal(layout.dataStart, 3);
});

test("does not mistake a dense data row for a header", () => {
  const rows = [
    ["Báo cáo"],
    ["STT", "Mã số thuế", "Họ tên", "Ngày sinh", "Địa chỉ"],
    [1, "0101", "Nguyễn Văn A", "01/01/1980", "Cà Mau"],
    [2, "0102", "Trần Thị B", "02/02/1981", "Cà Mau"],
    [3, "0103", "Lê Văn C", "03/03/1982", "Cà Mau"],
    [4, "0104", "Phạm Thị D", "04/04/1983", "Cà Mau"],
  ];
  assert.equal(detectSpreadsheetTableLayout(rows).headerStart, 1);
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

test("continues STT from the greatest existing value", () => {
  const headers = ["STT", "Mã số thuế", "Họ tên"];
  const sequenceColumn = findSpreadsheetSequenceColumn(headers);
  assert.equal(sequenceColumn, 0);
  assert.equal(nextSpreadsheetSequenceValue([[1, "01", "A"], [2, "02", "B"], ["10", "03", "C"]], sequenceColumn), 11);
});
