import type { ReactNode } from "react";
import "./qr-scanner.css";
import QrScannerEnhancer from "./qr-scanner-enhancer";

export default function TransferLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <QrScannerEnhancer />
    </>
  );
}
