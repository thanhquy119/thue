# Remotion legal-video template

Bản thử video dọc 1080×1920 cho Thông tư 89/2026/TT-BTC. Nội dung, giọng đọc, thời lượng cảnh và phụ đề được tạo từ `content/video.json`.

## Thành phần

- Remotion 4 dựng hình và animation.
- `edge-tts` tạo giọng Việt neural `vi-VN-HoaiMyNeural`.
- `ffprobe` đo thời lượng từng file đọc.
- `scripts/generate-assets.py` tự tạo `src/data.ts`, audio và timeline phụ đề.
- GitHub Actions render MP4, nên máy cá nhân không phải chạy TTS hay render.

## Tạo video khác

1. Tạo branch mới từ branch thử nghiệm này.
2. Sửa `content/video.json`:
   - `slug` và `compositionId`;
   - tiêu đề, nội dung từng cảnh;
   - `narration` là câu giọng đọc;
   - `captionChunks` là các câu phụ đề ngắn;
   - `bullets`, `cards`, `tag`, `badgeTop`, `badgeBottom` là dữ liệu hình ảnh.
3. Push branch để GitHub Actions tạo video.
4. Tải MP4 trong artifact của workflow.

## Video dài hơn

Không nên kéo một cảnh quá dài. Chia nội dung thành nhiều cảnh, mỗi cảnh khoảng 7–14 giây và tối đa ba ý hiển thị. Với video từ 2–5 phút, nên chia thành các chương và render từng chương trước khi ghép.

Cấu trúc gợi ý:

- Mở đầu: số hiệu và chủ đề.
- Phạm vi, đối tượng áp dụng.
- Điểm mới hoặc thay đổi chính.
- Nghĩa vụ, thủ tục, thời hạn.
- Mức tiền, tỷ lệ hoặc biểu mẫu nếu có.
- Hiệu lực và chuyển tiếp.
- Danh sách việc cần chuẩn bị.

## Chạy local

Yêu cầu: Node.js 22, Python 3.12 và FFmpeg.

```bash
python -m pip install edge-tts==7.2.8
npm install
npm run studio
```

Render:

```bash
npm run render
```

Video nằm tại `out/thong-tu-89-2026.mp4`.

Bản thử nằm trên branch `spike/remotion-tt89-demo`, chưa merge vào `main`.
