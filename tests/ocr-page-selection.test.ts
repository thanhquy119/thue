import assert from "node:assert/strict";
import test from "node:test";
import { chunkOcrPages, formatOcrPageSelection, parseOcrPageSelection } from "../lib/legal/ocr-page-selection.ts";

test("parses pages and ranges without duplicates", () => {
  assert.deepEqual(parseOcrPageSelection("12-14, 13, 20"), [12, 13, 14, 20]);
});

test("accepts reversed ranges and Vietnamese dash variants", () => {
  assert.deepEqual(parseOcrPageSelection("5–3; 9"), [3, 4, 5, 9]);
});

test("rejects invalid page syntax", () => {
  assert.throws(() => parseOcrPageSelection("12 đến 14"), /Không hiểu phạm vi trang/u);
});

test("formats and chunks pages for the three-page API limit", () => {
  const pages = [13, 12, 14, 20, 20];
  assert.equal(formatOcrPageSelection(pages), "12, 13, 14, 20");
  assert.deepEqual(chunkOcrPages(parseOcrPageSelection("12-14,20")), [[12, 13, 14], [20]]);
});
