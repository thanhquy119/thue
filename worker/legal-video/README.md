# Legal video worker (spike)

Worker này chạy **ngoài Vercel**. Giao diện Next.js chỉ tạo yêu cầu, xem storyboard và lưu trạng thái; máy local/GPU worker thực hiện OCR, TTS và render.

## Lựa chọn renderer

Spike dùng **HyperFrames 0.6.62** vì dự án hiện tại đã dùng Node 22, HyperFrames cũng yêu cầu Node 22, composition là HTML dễ sinh tự động, render xác định và Apache-2.0. Không cài đồng thời Remotion/Revideo trong spike đầu tiên.

## Cài tối thiểu

- Node.js 22
- Python 3.11+
- FFmpeg 6+
- Ollama và model `qwen3:8b`
- Docling nếu đầu vào là PDF
- VieNeu-TTS theo hướng dẫn chính thức của dự án
- faster-whisper chỉ dùng kiểm tra lại lời đọc, không dùng làm nguồn mốc phụ đề chính

```bash
ollama pull qwen3:8b
pip install docling faster-whisper
python worker/legal-video/pipeline.py van-ban.pdf --out .video-lab/worker-demo --dry-run
```

Chế độ `--dry-run` vẫn tạo `storyboard.json`, `index.html` và `subtitles.vtt` mà không cần VieNeu-TTS hay FFmpeg.

Sau khi VieNeu-TTS đã cài và `ffmpeg`, `ffprobe`, `npx` có trong PATH:

```bash
python worker/legal-video/pipeline.py van-ban.pdf --out .video-lab/worker-demo
```

Kết quả cuối: `.video-lab/worker-demo/legal-summary.mp4`.

## Vì sao không dùng faster-whisper để căn phụ đề ngay từ đầu?

VieNeu-TTS được gọi **theo từng cảnh**. Worker đo chính thời lượng WAV của từng cảnh bằng `ffprobe`, ghép audio rồi tạo VTT từ các khoảng thời gian đã biết. Cách này tránh vòng TTS → ASR và giữ mốc cảnh ổn định. faster-whisper chỉ tạo `whisper-qc.txt` để phát hiện câu đọc sai hoặc thiếu.

## Hướng tích hợp production

1. Dùng toàn văn đã được Thuế Rõ lưu và chuẩn hóa; không chạy Docling lại nếu không cần.
2. Vercel tạo job và ghi manifest vào Blob/R2.
3. Worker riêng polling hàng đợi, tải manifest, chạy pipeline và tải MP4/VTT/storyboard lên storage.
4. Vercel chỉ trả trạng thái và URL xem video.
5. Mọi cảnh phải giữ `sourceExcerpt` để người dùng mở đúng đoạn toàn văn.
