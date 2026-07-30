import type { ReactNode } from "react";
import "./qr-scanner.css";
import "./icon-reset.css";
import "./reader-overrides.css";
import "./transfer-table-format.css";
import "./transfer-ux.css";
import "./spreadsheet-workspace.css";
import PwaContextEnhancer from "./pwa-context-enhancer";
import QrScannerEnhancer from "./qr-scanner-enhancer";
import TableFormatEnhancer from "./table-format-enhancer";
import TransferPolishEnhancer from "./transfer-polish-enhancer";
import TransferUxEnhancer from "./transfer-ux-enhancer";
import SpreadsheetWorkspaceEnhancer from "./spreadsheet-workspace-enhancer";

export default function TransferLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <PwaContextEnhancer />
      <QrScannerEnhancer />
      <TableFormatEnhancer />
      <TransferPolishEnhancer />
      <TransferUxEnhancer />
      <SpreadsheetWorkspaceEnhancer />
    </>
  );
}
