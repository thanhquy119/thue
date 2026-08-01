# Remotion demo — Thông tư 89/2026/TT-BTC

Bản thử video dọc 1080×1920, khoảng 44 giây, có giọng đọc tiếng Việt bằng `espeak-ng` và phụ đề JSON theo kiểu `Caption` của Remotion.

## Nguồn nội dung

- Cổng Thông tin điện tử Chính phủ: hồ sơ chính thức Thông tư 89/2026/TT-BTC; ban hành 30/06/2026, hiệu lực 01/07/2026.
- Báo Điện tử Chính phủ: bài giới thiệu điểm mới về kiểm tra thuế bằng phương thức điện tử và các lợi ích đối với người nộp thuế.

Video chỉ tóm tắt nội dung phục vụ thử nghiệm giao diện, không thay thế toàn văn chính thức.

## Chạy local

```bash
sudo apt-get install -y espeak-ng ffmpeg
mkdir -p public/audio out
# Tạo các file WAV theo workflow trong .github/workflows/remotion-tt89-demo.yml
npm install
npm run studio
npm run render
```

Bản thử nằm trên branch `spike/remotion-tt89-demo`, không merge vào `main`.
