import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./candidates.css";
import "./refinements.css";
import SavedDocuments from "./saved-documents";

export const metadata: Metadata = {
  title: "Thuế — Tra cứu và đọc toàn văn pháp luật thuế",
  description: "Tra cứu văn bản và câu hỏi thuế, đọc toàn văn từ nguồn chính thức.",
  applicationName: "Thuế",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Thuế" },
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
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}<SavedDocuments /></body></html>;
}
