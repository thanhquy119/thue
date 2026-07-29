import type { ReactNode } from "react";
import QrScannerEnhancer from "./qr-scanner-enhancer";

export default function TransferLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <QrScannerEnhancer />
    </>
  );
}
