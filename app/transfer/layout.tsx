import type { ReactNode } from "react";
import "./qr-scanner.css";
import "./icon-reset.css";
import "./reader-overrides.css";
import "./spreadsheet-workspace.css";
import QrScannerEnhancer from "./qr-scanner-enhancer";
import TransferPolishEnhancer from "./transfer-polish-enhancer";
import SpreadsheetWorkspaceEnhancer from "./spreadsheet-workspace-enhancer";

export default function TransferLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <QrScannerEnhancer />
      <TransferPolishEnhancer />
      <SpreadsheetWorkspaceEnhancer />
    </>
  );
}
