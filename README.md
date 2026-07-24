# Thuế Rõ — tra cứu nguyên văn pháp luật thuế

Thuế Rõ ưu tiên hiển thị nguyên văn từ nguồn chính thức và không dùng nội dung tóm tắt, menu trang web hoặc OCR chưa đạt chất lượng như thể đó là toàn văn pháp luật.

## Luồng ứng dụng

- Trang đầu chỉ có ô tra cứu, không tải toàn bộ kho văn bản khi mở trang.
- Gemini Google Search Grounding chỉ dùng để tìm và đối chiếu nguồn chính thức.
- Kết quả tra số hiệu hiển thị một văn bản chính hoặc hồ sơ nguồn khi toàn văn chưa đạt yêu cầu.
- Câu hỏi nghiệp vụ trả lời ngắn trước, sau đó gắn với văn bản chính liên quan.
- Chỉ dùng `official_text`; không tạo một bản diễn giải rồi gọi đó là nguyên văn.
- Bookmark và tiến độ nghe được lưu trong IndexedDB trên thiết bị.

## Pipeline nhập văn bản bền vững

Các văn bản mới được xử lý ngoài request tra cứu bằng Vercel Workflow:

```text
Cron phát hiện văn bản mới
  → tải và lưu dấu vân tay nguồn
  → DOCX
  → DOC
  → PDF có lớp chữ
  → HTML có nội dung pháp lý
  → OCR theo nhóm 3 trang
  → ghép trang và kiểm tra chất lượng
  → ready | needs_review | failed
```

### Nguyên tắc xử lý

- Ưu tiên định dạng: `DOCX → DOC → PDF text → HTML → OCR`.
- Giới hạn nguồn mặc định là 100 MB, cấu hình bằng `LEGAL_MAX_SOURCE_BYTES`.
- PDF scan được OCR theo nhóm tối đa ba trang; mỗi nhóm là một Workflow step có thể retry độc lập.
- Khi có Vercel Blob, file nguồn, checkpoint từng trang, trạng thái và revision đã duyệt được lưu bền vững.
- Revision chỉ được công bố khi đúng số hiệu, ngày ban hành, cấu trúc pháp lý và đủ toàn bộ trang.
- OCR một phần, thiếu trang, chất lượng thấp, `[không đọc rõ]` quá ngưỡng hoặc thứ tự Điều bất thường đều chuyển sang `needs_review`.
- `processing`, `needs_review` và `failed` chỉ trả metadata/nguồn; không trả phần chữ chưa duyệt như toàn văn.
- Các revision `ready` được ưu tiên trong tra cứu sau lớp câu trả lời nghiệp vụ đã xác minh.

### Cron

`vercel.json` chạy discovery hằng ngày lúc `01:17 UTC`, tương đương `08:17` tại Việt Nam.

Cron chỉ khởi động Workflow. Nó không OCR toàn bộ tài liệu trong request Cron và sẽ trả lỗi an toàn nếu chưa kết nối Vercel Blob.

## Cấu hình

```bash
cp .env.example .env.local
```

Các biến chính:

```env
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.5-flash-lite
OCR_GEMINI_MODEL=gemini-3.5-flash-lite
ENABLE_OCR_FALLBACK=true
ENABLE_OCR_LAB=false
RATE_LIMIT_SALT=mot-chuoi-bi-mat-ngau-nhien

BLOB_READ_WRITE_TOKEN=...
LEGAL_BLOB_ACCESS=public
LEGAL_MAX_SOURCE_BYTES=100000000
LEGAL_CRON_MAX_RUNS=8
CRON_SECRET=mot-chuoi-bi-mat-dai
INGESTION_ADMIN_SECRET=mot-chuoi-bi-mat-khac
```

`BLOB_READ_WRITE_TOKEN` là điều kiện bắt buộc để bật lưu checkpoint, công bố revision và Cron production. Không có token, Preview vẫn có thể chạy smoke test không lưu nhưng production sẽ không tạo công việc không thể khôi phục.

## Chạy và kiểm tra

```bash
npm install
npm run dev
```

Kiểm tra đầy đủ trước khi deploy:

```bash
npm run verify
```

Build thông thường chạy unit/regression tests và bỏ qua live smoke tests. Live tests chỉ chạy khi đặt biến môi trường hoặc dùng marker commit:

```bash
RUN_LIVE_INGESTION_SMOKE=true npm run smoke:live
RUN_LIVE_QUESTION_SMOKE=true npm run smoke:questions
```

Live ingestion matrix hiện kiểm tra:

- Trang Công báo tự chọn DOCX chính thức.
- DOCX trực tiếp có cùng SHA-256 với attachment từ trang Công báo.
- PDF có lớp chữ được đọc bằng `pdf_text`.
- PDF scan 94/2026/TT-BTC khoảng 13 MB được nhận diện là `ocr_required`.
- OCR các trang đại diện giữ đúng số hiệu nhưng vẫn bị chặn công bố khi chưa đủ toàn bộ trang.

Live question matrix kiểm tra:

- Câu hỏi neo theo toàn văn chính thức 87/2026/TT-BTC.
- 94/2026/TT-BTC không hiển thị toàn văn giả khi OCR chưa hoàn tất.
- Câu hỏi hộ kinh doanh, hóa đơn máy tính tiền và thay đổi mã số thuế.
- 97/2026/TT-BTC trả đúng văn bản bị bãi bỏ.

## API vận hành

- `POST /api/ingestion/start`: khởi động một Workflow nhập văn bản, được bảo vệ bằng secret ở production.
- `GET /api/ingestion/run/:runId`: xem trạng thái Workflow run.
- `GET /api/ingestion/status?number=...`: xem trạng thái và revision đã công bố trong Blob.
- `GET /api/cron/legal-ingestion`: endpoint Cron discovery.
- `GET /api/ingestion/smoke`: chỉ tồn tại trên Preview; production luôn trả 404.

## OCR Lab

`/ocr-lab` tiếp tục dùng để xem chi tiết từng trang và so sánh nhiều lượt OCR:

- Hai lượt OCR độc lập trên ảnh gốc và ảnh tăng tương phản.
- Chạy lượt đối chiếu khi kết quả lệch hoặc chất lượng thấp.
- Giữ bảng, biểu mẫu, ô lựa chọn và cảnh báo `[không đọc rõ]`.
- Kết quả Lab không tự thay thế revision production.

## Lưu trữ và cache

- File nguồn và revision đã duyệt: Vercel Blob.
- Điều phối/retry: Vercel Workflow.
- Toàn văn cũ chưa chuyển sang pipeline vẫn có thể dùng Next.js Data Cache.
- Câu hỏi người dùng không được cache công khai.
- Trình duyệt giữ kết quả cùng phiên trong `sessionStorage`; bookmark và tiến độ nghe dùng IndexedDB.
- Không ghi file vào filesystem tạm của Vercel Function.

## Giới hạn an toàn

Không hệ thống nào bảo đảm tự động đọc hoàn hảo mọi văn bản. Nguồn chặn bot, tệp hỏng, scan có con dấu che chữ, bảng quá phức tạp hoặc metadata không khớp sẽ được retry và sau đó chuyển `needs_review`. Nguyên tắc mặc định là thiếu toàn văn thì báo thiếu, không tạo nội dung thay thế.
