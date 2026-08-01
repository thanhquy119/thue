# Spike tạo video tóm tắt văn bản

## Quyết định

- Renderer thử nghiệm: HyperFrames.
- Frontend/API điều phối: Next.js trên Vercel.
- Tác vụ nặng: worker local hoặc máy GPU riêng.
- LLM mặc định: Ollama `qwen3:8b`, JSON schema, temperature 0.
- Nguồn ưu tiên: toàn văn đã chuẩn hóa trong hệ thống; Docling chỉ dành cho PDF mới hoặc PDF ngoài hệ thống.
- TTS: VieNeu-TTS theo từng cảnh.
- Subtitle: thời lượng WAV từng cảnh là nguồn chính; faster-whisper dùng QC và word timestamps khi cần karaoke caption.
- Diagram: Mermaid → SVG trước khi render.
- Final: FFmpeg H.264/AAC, yuv420p, faststart.

## Tiêu chí đạt trước khi merge main

1. 20 văn bản thuộc ít nhất 5 loại có storyboard không bịa thông tin.
2. 100% cảnh có `sourceExcerpt` tìm thấy trong nguồn sau chuẩn hóa khoảng trắng.
3. Các ngày, tỷ lệ, mức tiền và số hiệu trong narration phải xuất hiện trong sourceExcerpt.
4. TTS đọc đúng các viết tắt thuế phổ biến và ngày/tháng/số tiền.
5. Video dọc 1080x1920, 30fps, dưới 120 giây, không tràn chữ trên mobile.
6. Worker có timeout, retry, idempotency và giới hạn đồng thời.
7. MP4, VTT, storyboard và phiên bản model/template được lưu cùng một manifest.
