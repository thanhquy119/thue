# Video tóm tắt văn bản pháp luật — serverless spike

## Mục tiêu

Người dùng tìm một văn bản như `Nghị định 178`, chọn đúng số hiệu, độ dài và giọng đọc rồi bấm **Tạo video tóm tắt**. Job tiếp tục chạy khi đóng tab; trang `/video-maker` tự khôi phục job gần nhất khi mở lại.

Bản spike nằm trên branch `spike/serverless-legal-video` và chưa merge vào `main`.

## Kiến trúc đã chốt

```text
Toàn văn đã chuẩn hóa trong Thuế Rõ
        ↓
Vercel Workflow bền vững
        ↓
Gemini trích ý theo từng phần, kèm đoạn nguồn
        ↓
Bộ kiểm tra và bù nhóm ý bị bỏ sót
        ↓
Storyboard Remotion
        ↓
Azure Speech tạo các đoạn WAV tiếng Việt
        ↓
Cloudflare R2 cache WAV và lưu dữ liệu job
        ↓
Remotion render trên Vercel Sandbox
        ↓
Cloudflare R2 lưu MP4 cuối
```

Pipeline không sử dụng AWS và không cần Vercel Blob. Vercel đảm nhiệm giao diện, API, Workflow và compute render; R2 là kho lưu trữ lâu dài duy nhất cho audio, storyboard, trạng thái và video.

### Không đọc lại PDF

Thuế Rõ đã có toàn văn và cấu trúc provision. Pipeline ưu tiên dữ liệu đã được xác minh thay vì đọc lại PDF, tránh tốn tài nguyên và tránh tạo ra một bản nội dung khác với trang văn bản.

### Xử lý nền

Mỗi phần tóm tắt, mỗi đoạn TTS và mỗi lần kiểm tra render là một step bền vững. Khi chờ hạn mức TTS hoặc đợi Sandbox, Workflow dùng `sleep()` thay vì giữ function chạy liên tục.

## Bảo đảm đủ ý chính

Pipeline không gửi toàn bộ văn bản vào một prompt duy nhất.

1. Chia toàn văn theo provision và giới hạn kích thước.
2. Trích evidence point từ từng phần; mỗi point có nhóm nội dung, mức quan trọng, claim, `sourceExcerpt` nguyên văn và provision ID.
3. Từ chối trích đoạn không có trong nguồn.
4. Từ chối con số, tỷ lệ, số tiền hoặc ngày tháng do model tự thêm.
5. Quét lại toàn văn để phát hiện phạm vi, sửa đổi, thủ tục, nghĩa vụ, thời hạn, số liệu, hiệu lực, chuyển tiếp và biểu mẫu.
6. Nhóm nào có trong toàn văn nhưng Gemini bỏ sót sẽ được bù bằng câu nguồn chính xác.
7. Storyboard chỉ nhóm các evidence point đã kiểm tra thành cảnh.
8. Kết quả lưu `coverageScore` và danh sách nhóm còn thiếu để kiểm toán.

Bản **Ngắn** ưu tiên ý quan trọng nhất. Bản **Tiêu chuẩn** cố gắng phủ các nhóm ý chính. Bản **Chi tiết** dành thêm cảnh cho điều kiện, ngoại lệ và chuyển tiếp.

## TTS và hạn mức

- Chia tại ranh giới câu tiếng Việt.
- Mục tiêu khoảng 480 ký tự, giới hạn cứng 720 ký tự mỗi request.
- Câu dài được tách tiếp ở dấu phẩy, chấm phẩy hoặc dấu hai chấm.
- Request chưa có cache chạy tuần tự, cách nhau tối thiểu 4 giây.
- Tối đa 5 lần thử lại và tôn trọng `Retry-After`.
- Workflow ngủ trong lúc chờ, không giữ compute.
- WAV được cache theo hash của giọng, tốc độ, cao độ và nội dung.
- Timeline dùng thời lượng thật đọc từ header WAV.

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
R2_ENDPOINT=...
R2_BUCKET=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
```

Tùy chọn:

```text
R2_REGION=auto
R2_PUBLIC_BASE_URL=https://media.example.com
VIDEO_GEMINI_MODEL=gemini-3.5-flash-lite
VIDEO_TTS_RATE=-4%
VIDEO_TTS_PITCH=+0Hz
VIDEO_TTS_FEMALE_VOICE=vi-VN-HoaiMyNeural
VIDEO_TTS_MALE_VOICE=vi-VN-NamMinhNeural
VIDEO_RENDER_CONCURRENCY=2
REMOTION_COMPOSITION_ID=LegalVideo
VIDEO_RENDER_SNAPSHOT_ID=...
REMOTION_LICENSE_KEY=...
```

`R2_PUBLIC_BASE_URL` không bắt buộc. Khi chưa có custom domain công khai, server tạo URL R2 ký ngắn hạn cho Remotion và cho lượt xem video.

`VIDEO_RENDER_SNAPSHOT_ID` chỉ dùng để ghi đè thủ công. Bình thường mỗi deployment tự bundle composition, tạo Sandbox snapshot không hết hạn và lưu snapshot ID vào R2 theo `VERCEL_DEPLOYMENT_ID`.

## Build và snapshot

Build root chạy:

```text
next build
npm run video:snapshot
```

Snapshot script tự bỏ qua khi spike chưa bật hoặc R2 chưa được cấu hình. Khi đủ cấu hình, mỗi deployment có snapshot riêng để không phải bundle và cài lại Remotion cho từng video.

## Dữ liệu trên R2

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

Fingerprint gồm phiên bản template, số hiệu, lần xác minh văn bản, toàn văn, độ dài và giọng. Cùng cấu hình sẽ dùng lại job/video cũ; cùng câu đọc sẽ dùng lại WAV cũ.

## Render không phụ thuộc Vercel Blob

Remotion 4.0.503 yêu cầu Vercel Blob khi dùng chế độ detached có sẵn của `renderMediaOnVercel`. Spike này tránh ràng buộc đó bằng cách:

1. Khôi phục Sandbox từ snapshot.
2. Chạy trực tiếp `render-video.mjs` ở chế độ detached.
3. Workflow đọc trạng thái command qua Sandbox API.
4. Khi render xong, server đọc MP4 trong `/tmp`.
5. MP4 được tải trực tiếp lên R2 rồi Sandbox dừng.

Người dùng xem video qua route ổn định `/api/videos/jobs/<jobId>/video`; route này chỉ tạo URL R2 ký ngắn hạn và chuyển hướng, không để lộ credential.

## Giao diện

Trang thử nghiệm: `/video-maker`.

Luồng:

1. Nhập tên hoặc số hiệu.
2. Chọn đúng kết quả khi truy vấn mơ hồ.
3. Chọn Ngắn, Tiêu chuẩn hoặc Chi tiết.
4. Chọn Hoài My hoặc Nam Minh.
5. Bấm **Tạo video tóm tắt**.
6. Có thể đóng tab sau khi nhận job ID.
7. Mở lại trang để tiếp tục theo dõi.

```text
queued → summarizing → synthesizing → rendering → ready
                                             ↘ failed
```

## An toàn và vận hành

- API tạo video có rate limit.
- Client không được gửi toàn văn tùy ý làm nguồn.
- Truy vấn mơ hồ bắt buộc chọn đúng số hiệu.
- Job và audio trùng được tái sử dụng.
- Media trên R2 mặc định là private; URL xem có thời hạn ngắn.
- Sandbox tự dừng sau hoàn tất hoặc lỗi.
- Không có AWS access key, S3 hay Lambda trong kiến trúc.
- Trước production cần thêm quota theo người dùng, lịch dọn dữ liệu và trang quản trị lịch sử job.
- Cần kiểm tra giấy phép Remotion phù hợp trước khi mở tính năng tạo video tự động rộng rãi.

## Giới hạn của spike

- `@remotion/vercel` và cách điều khiển Sandbox cần được kiểm thử tải thật trước production.
- “Đầy đủ ý chính” không có nghĩa đọc lại từng Điều/Khoản; bản tiêu chuẩn phủ nhóm nội dung quan trọng, bản chi tiết giữ thêm điều kiện và ngoại lệ.
- Video pháp luật nên có bước duyệt nội dung trước khi công khai tự động ở quy mô lớn.
