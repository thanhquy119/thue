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
  description: "Xem OCR theo đúng bố cục trang chính, chọn đúng vị trí để nghe và duyệt ma trận định dạng trước khi tích hợp.",
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
        <h1>Duyệt kỹ OCR trước khi đưa vào sử dụng.</h1>
        <div className="ocrLabIntro">
          <p>Hãy thử trước ma trận định dạng không tốn quota, sau đó mới chạy các trang khó của PDF chính thức bằng Gemini. Kết quả luôn được giữ riêng, chưa ghi vào kho văn bản.</p>
          <p>Bản xem thử dùng bố cục của main. Có thể chạm trực tiếp vào tiêu đề Điều, đoạn văn hoặc hàng bảng để đọc liên tục từ đúng vị trí đã chọn.</p>
        </div>
      </section>

      <OcrLabClient />
      <OcrMainSpeechReader />
    </main>
  );
}
