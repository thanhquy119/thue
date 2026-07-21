import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./candidates.css";
import "./refinements.css";
import "./question-results.css";
import "./document-tools.css";
import "./preamble.css";
import "./document-typography.css";
import CacheVersion from "./cache-version";
import SavedDocuments from "./saved-documents";
import DocumentTools from "./document-tools";

export const metadata: Metadata = {
  title: "Thuế — Tra cứu và đọc toàn văn pháp luật thuế",
  description: "Tra cứu văn bản và câu hỏi thuế, đọc toàn văn từ nguồn chính thức.",
  applicationName: "Thuế",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Thuế" },
  other: {
    "apple-mobile-web-app-status-bar-style": "default",
    "mobile-web-app-capable": "yes",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body><CacheVersion />{children}<SavedDocuments /><DocumentTools /></body></html>;
}
