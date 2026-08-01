import type {Metadata} from "next";
import {VideoMakerClient} from "./video-maker-client";
import "./video-maker.css";

export const metadata: Metadata = {
  title: "Tạo video tóm tắt văn bản | Thuế Rõ",
  description: "Tìm văn bản pháp luật và tạo video tóm tắt bằng pipeline serverless.",
};

export default function VideoMakerPage() {
  return (
    <main className="video-maker-page">
      <div className="video-maker-shell">
        <header className="video-maker-header">
          <a className="video-maker-brand" href="/">
            Thuế<span>.</span>
          </a>
          <div className="video-maker-kicker">VIDEO TÓM TẮT VĂN BẢN</div>
          <h1>Từ toàn văn đến video chỉ bằng một lần bấm</h1>
          <p>
            Tìm đúng văn bản, chọn độ dài và giọng đọc. Hệ thống sẽ chọn các ý chính có dẫn chứng,
            tạo giọng tiếng Việt, dựng video ở chế độ nền và trả lại tệp MP4.
          </p>
        </header>
        <VideoMakerClient />
      </div>
    </main>
  );
}
