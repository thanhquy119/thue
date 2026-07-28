# Thuế Rõ — phát hiện văn bản gần thời gian thực

Worker này gọi endpoint nhẹ của Thuế Rõ mỗi 5 phút:

- Phút chia hết cho 15: quét nguồn chính thức, ghi nhận ứng viên mới, gửi Push còn chờ và có thể khởi động tối đa một Workflow.
- Các phút còn lại: chỉ kiểm tra revision vừa hoàn tất và gửi Push, không tìm nguồn và không chạy OCR.

Lần chạy đầy đủ đầu tiên chỉ tạo mốc ban đầu (`bootstrap`) nên không nhập hàng loạt văn bản cũ. Từ lần sau, chỉ số hiệu chưa từng xuất hiện mới được đưa vào hàng đợi nhanh. Cron Vercel hằng ngày vẫn giữ vai trò đối soát, retry và dọn dữ liệu.

## Triển khai

Trong thư mục `cloudflare`:

```bash
npx wrangler secret put DISCOVERY_CRON_SECRET --config wrangler.fast-tax-discovery.jsonc
npx wrangler deploy --config wrangler.fast-tax-discovery.jsonc
```

Giá trị secret phải giống `DISCOVERY_CRON_SECRET` trên Vercel; nếu biến này chưa có, endpoint dùng `CRON_SECRET`. Không ghi secret vào mã nguồn, GitHub hoặc ảnh chụp màn hình.

Các giới hạn mặc định:

- `LEGAL_FAST_DISCOVERY_MAX_STARTS_PER_RUN=1`
- `LEGAL_FAST_DISCOVERY_MAX_STARTS_PER_DAY=2`
- `WEB_PUSH_FAST_SCAN_LIMIT=60`

Luồng 5 phút chỉ đọc trạng thái và gửi Push. OCR vẫn chạy riêng trong Workflow, có checkpoint và quality gate.
