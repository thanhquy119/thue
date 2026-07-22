# Thuế Rõ — bản đơn giản không dùng Supabase

Bản này thay đổi luồng ứng dụng theo yêu cầu:

- Trang đầu chỉ có ô tra cứu, không tải kho văn bản, không hiện tab Tất cả/Đang hiệu lực/Sắp hiệu lực/Hết hiệu lực.
- Không dùng Supabase hoặc cơ sở dữ liệu văn bản cố định.
- Gemini Google Search Grounding chỉ dùng để tìm nguồn chính thức.
- Máy chủ tải file HTML/DOCX/PDF có text từ nguồn chính thức, trích xuất toàn văn và lưu bằng Vercel/Next.js Data Cache trong 7 ngày.
- Kết quả tra số hiệu hiển thị duy nhất một văn bản chính và toàn văn của văn bản đó.
- Câu hỏi nghiệp vụ hiển thị câu trả lời ngắn, sau đó là toàn văn của văn bản chính liên quan.
- Bỏ hoàn toàn tab “Bản diễn giải/Nguyên văn”; chỉ còn nguyên văn.
- Điều được hiển thị một lần; phần tiêu đề không bị lặp lại trong thân bài.
- Khoản/điểm bị tách dòng trong PDF được ghép lại thành khối nội dung hợp lý.
- Giọng đọc dùng Speech Synthesis có sẵn trên iPhone/trình duyệt và cho phép chọn giọng, tốc độ.
- Bookmark và tiến độ nghe chỉ lưu trong IndexedDB trên thiết bị.

## Cấu hình

```bash
cp .env.example .env.local
```

Thêm API key lấy từ Google AI Studio:

```env
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.1-flash-lite
OCR_GEMINI_MODEL=gemini-3.1-flash-lite
ENABLE_OCR_LAB=false
RATE_LIMIT_SALT=mot-chuoi-bi-mat-ngau-nhien
```

Trên Vercel, thêm các biến cần dùng trong Project → Settings → Environment Variables.

## Chạy

```bash
npm install
npm run dev
```

Kiểm tra trước khi deploy:

```bash
npm run verify
```

## OCR Lab thử nghiệm

Nhánh thử nghiệm có trang `/ocr-lab` để so sánh lớp chữ sẵn có trong PDF với OCR nhiều lượt trước khi tích hợp vào luồng tra cứu chính.

- OCR Lab tự bật ở môi trường local và Vercel Preview.
- Production chỉ bật khi đặt `ENABLE_OCR_LAB=true`.
- Người thử nhập liên kết trực tiếp tới PDF thuộc miền cơ quan nhà nước đã cho phép.
- Mỗi trang được đọc hai lượt độc lập: một lượt chép nguyên văn và một lượt tập trung kiểm tra số hiệu, Điều/Khoản/Điểm, dấu tiếng Việt và các cặp ký tự dễ nhầm.
- Khi hai lượt khác nhau đáng kể, hệ thống chạy thêm lượt đối chiếu có ảnh gốc làm căn cứ.
- Hệ thống chấm điểm lớp chữ PDF và OCR, hiển thị độ giống nhau từng trang và đưa ra khuyến nghị giữ lớp chữ cũ, ưu tiên OCR hoặc kiểm tra thủ công.
- Kết quả OCR Lab không được lưu cache, không thay thế dữ liệu chính thức và không tác động trang tra cứu hiện tại.

Để hạn chế thời gian và chi phí trong giai đoạn thử, giao diện chỉ OCR tối đa 6 trang mỗi lần. Chỉ sau khi kiểm tra đủ nhiều mẫu PDF scan mới nên tích hợp fallback OCR vào `extractFromUrl`.

## Cơ chế cache

- Kết quả hỏi đáp không được cache công khai vì câu hỏi có thể chứa dữ liệu riêng tư.
- Toàn văn công khai sau khi trích xuất được lưu bằng `unstable_cache`, khóa theo URL nguồn và tự làm mới sau 7 ngày.
- Trình duyệt giữ kết quả của cùng một truy vấn trong `sessionStorage` cho phiên hiện tại.
- Không ghi file vào filesystem của Vercel Function và không cần database.

## Giới hạn thực tế

Không hệ thống nào có thể bảo đảm lấy được toàn văn của mọi văn bản chỉ bằng web search. Trường hợp nguồn chặn bot, liên kết Google redirect không giải được, PDF chỉ là ảnh scan hoặc file quá lớn, ứng dụng sẽ báo không thể trích xuất thay vì hiển thị nội dung tóm tắt như thể đó là toàn văn.
.
