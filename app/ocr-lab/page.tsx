import type { Metadata } from "next";
import Link from "next/link";
import OcrLabClient from "./ocr-lab-client";
import "./ocr-lab.css";

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
          <p>Hệ thống giữ nguyên lớp chữ PDF đang hoạt động tốt, đồng thời OCR mỗi trang hai lượt độc lập và chỉ chạy lượt đối chiếu thứ ba khi hai kết quả khác nhau đáng kể.</p>
          <p>Trang này chỉ dùng trên bản preview hoặc khi bật biến <code>ENABLE_OCR_LAB=true</code>. Kết quả chưa được tự động đưa vào kho văn bản chính thức.</p>
        </div>
      </section>

      <OcrLabClient />
    </main>
  );
}
