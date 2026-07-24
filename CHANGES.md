# Các lỗi chính đã sửa

1. `page.tsx` từng gọi `/api/documents` ngay khi mở trang, tự chọn văn bản đầu tiên và hiển thị toàn bộ kho. Bản hiện tại chỉ tải dữ liệu sau khi người dùng tra cứu.
2. Kết quả tìm kiếm cũ render ba nhóm trùng nhau: nguồn trực tuyến, căn cứ pháp lý và văn bản liên quan. Bản hiện tại ưu tiên một `document` chính hoặc hồ sơ nguồn rõ ràng.
3. `readerMode` từng tạo hai bản “diễn giải/nguyên văn”. Bản hiện tại chỉ dùng `official_text`.
4. `parseLegalHierarchy` cũ giữ dòng `Điều X` trong `officialText`, trong khi UI cũng dùng dòng đó làm tiêu đề. Bản hiện tại loại dòng tiêu đề khỏi thân Điều.
5. Cơ chế chia bằng dấu chấm từng biến `1.` hoặc `d)` thành câu độc lập. Bản hiện tại phân đoạn theo cấu trúc pháp luật và ghép marker với nội dung ngay sau.
6. Dữ liệu public được cache theo URL nguồn; dữ liệu riêng của câu hỏi không được đưa vào CDN cache.
7. Nội dung menu, thời tiết và phần bao ngoài của Cổng Chính phủ từng có thể bị nhận nhầm là toàn văn. Bộ quality gate hiện chặn portal shell và giữ lại đúng hồ sơ nguồn.
8. PDF scan lớn từng bị OCR toàn bộ trong một request và vượt thời gian. Pipeline mới dùng Vercel Workflow, OCR tối đa ba trang mỗi step, tự retry và lưu checkpoint từng trang.
9. Giới hạn nguồn 18 MB cũ đã được thay bằng giới hạn nền mặc định 100 MB có thể cấu hình, đồng thời giữ allowlist nguồn và fallback TLS có kiểm soát cho CDN Chính phủ.
10. Toàn văn OCR một phần từng có nguy cơ bị dùng trước khi đủ trang. Revision mới chỉ chuyển `ready` khi đạt 100% độ phủ trang và vượt qua kiểm tra số hiệu, ngày, Điều/Chương, chất lượng OCR và vùng không đọc rõ.
11. Các văn bản 89/90/94 từng đi qua nhiều ngoại lệ riêng trong request tra cứu. Kho revision bền vững tạo một đường đọc chung cho văn bản đã nhập `ready`; trạng thái `processing`, `needs_review` và `failed` chỉ trả metadata.
12. Bộ câu hỏi mới đã bổ sung regression cho hóa đơn máy tính tiền khi bán trực tiếp cho người tiêu dùng, giữ nguyên mã số thuế khi chuyển trụ sở khác tỉnh và Thông tư 97/2026/TT-BTC bãi bỏ Thông tư 55/2010/TT-BTC.
