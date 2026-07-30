# OCR PDF transfer throughput

- Model mặc định: Gemini 3.5 Flash Lite.
- Khoảng cách tối thiểu giữa hai request: 7 giây, tương đương tối đa khoảng 8,6 RPM.
- Giới hạn song song: 3 request đang chạy.
- Kích thước mỗi lượt: tối đa 6 trang.
- Trần này thấp hơn đáng kể mức 15 RPM của free tier, giữ hơn 40% khoảng đệm cho retry và tác vụ khác.
- Khi gặp 429/quota, checkpoint đã hoàn tất vẫn được giữ và hệ thống tự tạm nghỉ trước khi tiếp tục.
