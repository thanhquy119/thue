import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildFallbackVideoPlan,
  renderHyperframesHtml,
  renderVideoVtt,
} from "../lib/video/storyboard.ts";

const SAMPLE = `THÔNG TƯ MẪU VỀ QUẢN LÝ THUẾ ĐIỆN TỬ

Điều 1. Thông tư này hướng dẫn việc đăng ký, kê khai và nộp hồ sơ thuế bằng phương thức điện tử đối với tổ chức, hộ kinh doanh và cá nhân có nghĩa vụ thuế.

Điều 2. Người nộp thuế phải hoàn thành việc cập nhật thông tin đăng ký chậm nhất trong vòng 10 ngày làm việc kể từ ngày phát sinh thay đổi.

Điều 3. Tổ chức cung cấp dịch vụ có trách nhiệm lưu vết giao dịch, bảo đảm khả năng tra cứu và cung cấp dữ liệu khi cơ quan thuế yêu cầu.

Điều 4. Thông tư này có hiệu lực thi hành từ ngày 01 tháng 10 năm 2026. Hồ sơ đã tiếp nhận trước ngày có hiệu lực tiếp tục được giải quyết theo quy định tại thời điểm tiếp nhận.`;

const sourcePath = process.argv[2];
const source = sourcePath ? await readFile(path.resolve(sourcePath), "utf8") : SAMPLE;
const plan = buildFallbackVideoPlan(source);
const output = path.resolve(".video-lab/demo");
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(path.join(output, "storyboard.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8"),
  writeFile(path.join(output, "index.html"), renderHyperframesHtml(plan), "utf8"),
  writeFile(path.join(output, "subtitles.vtt"), renderVideoVtt(plan), "utf8"),
]);
console.log(`[video-demo] Đã tạo ${output}`);
console.log("[video-demo] Xem thử: npx -y hyperframes@0.6.62 preview .video-lab/demo/index.html");
console.log("[video-demo] Render: npm run video:render");
