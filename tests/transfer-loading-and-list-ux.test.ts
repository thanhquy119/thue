import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("table columns stretch to consume available width without a blank strip", () => {
  const enhancer = source("../app/transfer/table-format-enhancer.tsx");
  assert.match(enhancer, /minmax\(\$\{width\}px, \$\{Math\.max\(1, width \/ 120\)\.toFixed\(2\)\}fr\)/u);
  assert.match(enhancer, /transferTablePolished === "3"/u);
});

test("transfer page exposes immediate upload and file-opening feedback", () => {
  const layout = source("../app/transfer/layout.tsx");
  const enhancer = source("../app/transfer/transfer-ux-enhancer.tsx");
  const styles = source("../app/transfer/transfer-ux.css");

  assert.match(layout, /TransferUxEnhancer/u);
  assert.match(layout, /transfer-ux\.css/u);
  assert.match(styles, /uploadCard:has\(input:disabled\)/u);
  assert.match(styles, /transferBusySpin/u);
  assert.match(enhancer, /isOpening/u);
  assert.match(enhancer, /aria-busy/u);
});

test("long file lists scroll internally and provision navigation is hidden", () => {
  const styles = source("../app/transfer/transfer-ux.css");
  assert.match(styles, /\.transferList\s*\{[\s\S]*max-height:/u);
  assert.match(styles, /overflow-y:\s*auto/u);
  assert.match(styles, /\.transferProvisionNav\s*\{[\s\S]*display:\s*none\s*!important/u);
});

test("legacy slow quota wording is replaced with a neutral upload confirmation", () => {
  const enhancer = source("../app/transfer/transfer-ux-enhancer.tsx");
  assert.match(enhancer, /PDF scan đang xếp hàng OCR chậm để bảo vệ hạn mức/u);
  assert.match(enhancer, /message\.textContent = "Đã gửi file\."/u);
});
