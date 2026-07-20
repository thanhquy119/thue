# Các lỗi chính trong bản cũ đã sửa

1. `page.tsx` gọi `/api/documents` ngay khi mở trang, tự chọn văn bản đầu tiên và hiển thị toàn bộ kho. Bản mới không gọi API này nữa.
2. Kết quả tìm kiếm cũ render ba nhóm trùng nhau: nguồn trực tuyến, căn cứ pháp lý và văn bản liên quan. Bản mới chỉ trả một `document` chính.
3. `readerMode` tạo hai bản “diễn giải/nguyên văn”. Bản mới chỉ dùng `official_text`.
4. `parseLegalHierarchy` cũ giữ dòng `Điều X` trong `officialText`, trong khi UI cũng dùng dòng đó làm tiêu đề, gây lặp. Bản mới loại dòng tiêu đề khỏi thân Điều.
5. Cơ chế chia bằng dấu chấm biến `1.` hoặc `d)` thành câu độc lập. Bản mới phân đoạn theo cấu trúc pháp luật và ghép marker với nội dung ngay sau.
6. Dữ liệu public được cache theo URL nguồn; dữ liệu riêng của câu hỏi không được đưa vào CDN cache.
