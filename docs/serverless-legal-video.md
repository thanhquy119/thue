# Video tóm tắt văn bản pháp luật — serverless spike

## Mục tiêu

Người dùng có thể tìm một văn bản như `Nghị định 178`, chọn đúng số hiệu khi có nhiều kết quả, chọn độ dài và giọng đọc, sau đó bấm **Tạo video tóm tắt**. Job tiếp tục chạy khi đóng tab và trang `/video-maker` tự khôi phục job gần nhất khi mở lại.

Bản spike nằm trên branch `spike/serverless-legal-video` và chưa được merge vào `main`.

## Kiến trúc

```text
Toàn văn đã chuẩn hóa trong Thuế Rõ
        ↓
Vercel Workflow bền vững
        ↓
Chia văn bản theo Điều/Khoản/phần khoảng 8.500 ký tự
        ↓
Gemini trích từng nhóm ý kèm đoạn nguồn nguyên văn
        ↓
Bộ kiểm tra và bù nhóm ý bị bỏ sót
        ↓
Storyboard Remotion
        ↓
Azure Speech chia nhỏ giọng đọc
        ↓
Vercel Blob cache WAV
        ↓
Remotion render detached trên Vercel Sandbox
        ↓
MP4 công khai trong Vercel Blob
```

### Vì sao không dùng PDF hoặc Docling ở bước này

Thuế Rõ đã có toàn văn và cấu trúc provision. Pipeline ưu tiên dữ liệu đã được xác minh thay vì đọc lại PDF, tránh tốn tài nguyên và tránh sinh ra một bản nội dung khác với trang văn bản.

### Vì sao dùng Vercel Workflow

Mỗi phần tóm tắt, mỗi đoạn TTS và mỗi lần kiểm tra tiến độ render là một step bền vững. Khi cần chờ hạn mức TTS hoặc đợi Remotion, workflow dùng `sleep()` thay vì giữ serverless function chạy liên tục.

## Bảo đảm đủ ý chính

Pipeline không gửi toàn bộ văn bản vào một prompt duy nhất.

1. Chia toàn văn theo provision và giới hạn kích thước.
2. Trích evidence point từ từng phần, mỗi point có:
   - nhóm nội dung;
   - mức quan trọng;
   - claim;
   - `sourceExcerpt` nguyên văn;
   - provision ID.
3. Từ chối trích đoạn không tìm thấy trong nguồn.
4. Từ chối con số, tỷ lệ, số tiền hoặc ngày tháng do model tự thêm.
5. Quét lại toàn văn bằng quy tắc để phát hiện các nhóm:
   - phạm vi và đối tượng;
   - sửa đổi, bổ sung;
   - hồ sơ và thủ tục;
   - nghĩa vụ;
   - thời hạn;
   - số tiền và tỷ lệ;
   - hiệu lực;
   - chuyển tiếp;
   - biểu mẫu và phụ lục.
6. Nhóm nào có trong toàn văn nhưng lượt Gemini bỏ sót sẽ được bù bằng một câu nguồn chính xác.
7. Storyboard nhóm các evidence point thành cảnh; nội dung bullet và lời đọc được lấy trực tiếp từ evidence point đã kiểm tra.
8. Kết quả giữ `coverageScore` và danh sách nhóm còn thiếu để kiểm toán.

Bản **Ngắn** ưu tiên các ý quan trọng nhất. Bản **Tiêu chuẩn** được thiết kế để phủ các nhóm ý chính. Bản **Chi tiết** dành thêm cảnh cho điều kiện, ngoại lệ và nội dung chuyển tiếp.

## Cách chia TTS để tránh limit

- Chia tại ranh giới câu tiếng Việt.
- Mục tiêu khoảng 480 ký tự mỗi request.
- Giới hạn cứng 720 ký tự mỗi request.
- Câu quá dài được tách tiếp ở dấu phẩy, chấm phẩy hoặc dấu hai chấm.
- Các request chưa có cache chạy tuần tự, cách nhau tối thiểu 4 giây.
- Tối đa 5 lần thử lại.
- Tôn trọng `Retry-After` khi Azure trả 429 hoặc lỗi tạm thời.
- Workflow ngủ trong lúc chờ, không giữ compute.
- Audio được cache theo hash của giọng, tốc độ, cao độ và nội dung. Cùng một câu sẽ không bị tính TTS lại.
- Mỗi WAV được đo thời lượng thật từ header PCM; timeline Remotion không ước lượng theo số chữ.

Giọng mặc định:

- Nữ: `vi-VN-HoaiMyNeural`
- Nam: `vi-VN-NamMinhNeural`

## Cấu hình Vercel

### Bắt buộc

```text
VIDEO_EXPERIMENT_ENABLED=true
GEMINI_API_KEY=...
AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=...
```

Project cần kết nối một **Vercel Blob store public**. Vercel tự thêm:

```text
BLOB_READ_WRITE_TOKEN=...
```

Job/source/storyboard tiếp tục dùng storage hiện có của Thuế Rõ qua `lib/storage/r2-blob-compat.ts`.

### Tùy chọn

```text
VIDEO_GEMINI_MODEL=gemini-3.5-flash-lite
VIDEO_TTS_RATE=-4%
VIDEO_TTS_PITCH=+0Hz
VIDEO_TTS_FEMALE_VOICE=vi-VN-HoaiMyNeural
VIDEO_TTS_MALE_VOICE=vi-VN-NamMinhNeural
REMOTION_COMPOSITION_ID=LegalVideo
VIDEO_RENDER_SNAPSHOT_ID=...
```

`VIDEO_RENDER_SNAPSHOT_ID` chỉ dùng để ghi đè thủ công. Bình thường build Vercel tự bundle composition, tạo Sandbox snapshot và lưu snapshot ID trong Blob theo `VERCEL_DEPLOYMENT_ID`.

## Build và snapshot

Lệnh build root chạy:

```text
next build
npm run video:snapshot
```

Snapshot script tự bỏ qua khi spike chưa bật hoặc chưa kết nối Blob, nên CI và preview không có secret vẫn build được. Khi cấu hình đầy đủ, mỗi deployment có snapshot riêng, tránh cài package và bundle lại mỗi lần người dùng tạo video.

## Dữ liệu lưu trữ

```text
legal-video/jobs/<jobId>.json
legal-video/fingerprints/<fingerprint>.json
legal-video/sources/<fingerprint>.json
legal-video/storyboards/<jobId>.json
legal-video/tts/<hash>.wav
legal-video/tts-metadata/<hash>.json
legal-video/renders/<jobId>/<document-slug>.mp4
legal-video/snapshots/<deploymentId>.json
```

Fingerprint gồm phiên bản template, số hiệu, lần xác minh văn bản, toàn văn, độ dài và giọng. Người dùng bấm lại cùng cấu hình sẽ nhận lại job/video cũ thay vì render trùng.

## Giao diện

Trang thử nghiệm:

```text
/video-maker
```

Luồng sử dụng:

1. Nhập tên hoặc số hiệu.
2. Chọn đúng kết quả nếu có nhiều văn bản cùng số.
3. Chọn Ngắn, Tiêu chuẩn hoặc Chi tiết.
4. Chọn giọng Hoài My hoặc Nam Minh.
5. Bấm **Tạo video tóm tắt**.
6. Có thể đóng tab sau khi nhận job ID.
7. Mở lại `/video-maker`; trình duyệt đọc job ID gần nhất từ URL/localStorage và tiếp tục hiển thị tiến độ.

Trạng thái:

```text
queued → summarizing → synthesizing → rendering → ready
                                             ↘ failed
```

## Quản lý chi phí và an toàn

- API tạo video có rate limit.
- Chỉ server mới tra cứu và chụp toàn văn; client không được gửi một bản văn tùy ý làm nguồn pháp lý.
- Truy vấn mơ hồ bắt buộc chọn đúng số hiệu.
- Job trùng được tái sử dụng theo fingerprint.
- Audio trùng được tái sử dụng theo content hash.
- Remotion chạy detached trong Sandbox và tự dừng ở trạng thái hoàn tất/lỗi/hết hạn.
- Nên bật Vercel Spend Management trước khi mở rộng cho người dùng đại trà.
- Trước production cần thêm cron dọn MP4/job hết hạn và trang quản trị xem lịch sử toàn hệ thống.

## Giới hạn của spike

- `@remotion/vercel` hiện là hướng render thử nghiệm, cần test tải thật trước khi mở production.
- Chưa có khóa Azure Speech và Blob trong CI nên CI chỉ xác nhận code, unit test, TypeScript và build; không khẳng định MP4 end-to-end cho tới khi cấu hình dịch vụ.
- “Đầy đủ ý chính” không có nghĩa là đọc lại từng Điều/Khoản. Bản tiêu chuẩn cố gắng phủ toàn bộ nhóm nội dung quan trọng; bản chi tiết giữ thêm điều kiện và ngoại lệ.
- Video pháp luật vẫn nên có bước duyệt nội dung trước khi công khai tự động ở quy mô lớn.
