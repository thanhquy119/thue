import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("transfer reader wires semantic formatting for appendices and closing blocks", () => {
  const layout = source("../app/transfer/layout.tsx");
  const enhancer = source("../app/transfer/document-format-enhancer.tsx");
  const styles = source("../app/transfer/document-format.css");

  assert.match(layout, /DocumentFormatEnhancer/u);
  assert.match(layout, /document-format\.css/u);
  assert.match(enhancer, /APPENDIX_TITLE/u);
  assert.match(enhancer, /RECIPIENTS/u);
  assert.match(enhancer, /SIGNATURE_ROLE/u);
  assert.match(enhancer, /transferSignerName/u);
  assert.match(styles, /\.transferAppendixTitle/u);
  assert.match(styles, /\.transferRecipients/u);
  assert.match(styles, /\.transferSignatureRole/u);
});

test("table formatter preserves explicit columns and only merges structural blank cells", () => {
  const enhancer = source("../app/transfer/table-format-enhancer.tsx");
  const styles = source("../app/transfer/transfer-table-format.css");

  assert.match(enhancer, /placeRowCells/u);
  assert.match(enhancer, /cell\.style\.gridColumn = String\(columnIndex \+ 1\)/u);
  assert.match(enhancer, /transferStructuredMergedCell/u);
  assert.match(enhancer, /columnCount >= 7 && columnIndex === 0/u);
  assert.match(styles, /transferStructuredCell\[hidden\]/u);
  assert.match(styles, /width:\s*max\(100%, var\(--transfer-table-min-width/u);
});
