import type { Metadata } from "next";
import Link from "next/link";
import OcrMainSpeechReader from "./ocr-main-speech-reader";
import OcrLabClient from "./ocr-lab-client";
import "./ocr-lab.css";
import "./ocr-preview.css";
import "./ocr-table.css";
import "./ocr-speech.css";
import "./ocr-main-preview.css";

export const metadata: Metadata = {
  title: "OCR Lab — Thuế",
  description: "Xem OCR theo đúng bố cục trang chính, nghe thử nội dung và so sánh các model trước khi tích hợp.",
};

export default function OcrLabPage() {
  return (
    <main className="ocrLabShell">
      <header className="ocrLabTopbar">
        <Link href="/" className="ocrLabBrand">Thuế<span>.</span></Link>
        <span>Thử nghiệm riêng biệt</span>
      </header>

      <section className="ocrLabHero">
        <p>OCR LAB · KHÔNG ẢNH HƯỞNG BẢN HIỆN TẠI</p>
        <h1>Kiểm tra OCR trước khi đưa vào sử dụng.</h1>
        <div className="ocrLabIntro">
          <p>Hệ thống giữ nguyên lớp chữ PDF đang hoạt động tốt, đồng thời OCR từng trang, xử lý logo/con dấu/nhiễu và cho phép chạy toàn bộ tệp theo từng đợt nhỏ.</p>
          <p>Kết quả được dựng ngay theo giao diện đọc của bản main, có tìm trong văn bản và nghe thử trước khi quyết định merge.</p>
        </div>
      </section>

      <OcrLabClient />
      <OcrMainSpeechReader />
    </main>
  );
}
