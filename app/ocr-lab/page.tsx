import type { Metadata } from "next";
import Link from "next/link";
import OcrLabClient from "./ocr-lab-client";
import "./ocr-lab.css";
import "./ocr-preview.css";
import "./ocr-table.css";

export const metadata: Metadata = {
  title: "OCR Lab — Thuế",
  description: "So sánh lớp chữ PDF với OCR nhiều lượt trước khi tích hợp vào luồng tra cứu chính.",
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
          <p>Hệ thống giữ nguyên lớp chữ PDF đang hoạt động tốt, đồng thời OCR từng trang nhiều lượt, xử lý logo/con dấu/nhiễu và cho phép chạy toàn bộ tệp theo từng đợt nhỏ.</p>
          <p>Kết quả có thêm bản trình bày thử nghiệm cho Điều/Khoản, biểu mẫu, dòng điền và bảng. Trang này chỉ chạy trên preview; dữ liệu chưa được đưa vào kho văn bản chính thức.</p>
        </div>
      </section>

      <OcrLabClient />
    </main>
  );
}
