function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9%/_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const QUESTION_PATTERN =
  /\?|\b(?:bao nhieu|the nao|nhu the nao|duoc khong|co phai|phai khong|tai sao|can lam gi|bao gio|han nop|thoi han|mau nao|cach tinh|ap dung|xu ly|phan tich|giai thich|doi chieu|huong dan|khai thue|nop thue|hoan thue|khau tru|quyet toan|hoa don|doanh thu|thue suat|chi phi duoc tru|mien thue|giam thue|khong chiu thue|dang ky thue|ma so thue|xu phat|cham nop|phan bo|khai tap trung)\b/;

export function currentBackboneQueries(query: string) {
  const normalized = normalize(query);
  const queries: string[] = [];

  if (/\b(?:dang ky thue|ma so thue|thay doi thong tin|chuyen dia chi|khoi phuc ma so|cham dut ma so)\b/.test(normalized)) {
    queries.push("90/2026/TT-BTC", "108/2025/QH15");
  }

  if (/\b(?:ho kinh doanh|ca nhan kinh doanh|cho thue nha|cho thue bat dong san|doanh thu)\b/.test(normalized)) {
    queries.push("141/2026/NĐ-CP", "50/2026/TT-BTC", "18/2026/TT-BTC");
  }

  if (/\b(?:hoa don|may tinh tien|dat coc|chu ky so|nguoi mua|lap hoa don|giao hoa don)\b/.test(normalized)) {
    queries.push("254/2026/NĐ-CP", "91/2026/TT-BTC");
  }

  if (/\b(?:quan ly thue|tam hoan xuat canh|no thue|cuong che|khai thue|nop thue|thoi han)\b/.test(normalized)) {
    queries.push("108/2025/QH15", "252/2026/NĐ-CP", "89/2026/TT-BTC");
  }

  if (/\b(?:thu nhap doanh nghiep|tndn|tam nop|doanh nghiep moi thanh lap)\b/.test(normalized)) {
    queries.push("141/2026/NĐ-CP", "320/2025/NĐ-CP");
  }

  return Array.from(new Set(queries)).slice(0, 4);
}

export function questionSearchQueries(query: string, currentYear = new Date().getFullYear()) {
  const normalized = normalize(query);
  if (!QUESTION_PATTERN.test(normalized)) return [query];

  const topical: string[] = [];
  if (/\b(?:ho kinh doanh|ca nhan kinh doanh)\b/.test(normalized)) {
    topical.push(`chính sách thuế hộ kinh doanh cá nhân kinh doanh ${currentYear}`);
  } else if (/\b(?:hoa don|may tinh tien)\b/.test(normalized)) {
    topical.push(`quản lý thuế hóa đơn điện tử ${currentYear}`);
  } else if (/\b(?:thu nhap ca nhan|quyet toan|tncn)\b/.test(normalized)) {
    topical.push(`thuế thu nhập cá nhân quyết toán ${currentYear}`);
  } else if (/\b(?:gia tri gia tang|gtgt)\b/.test(normalized)) {
    topical.push(`thuế giá trị gia tăng ${currentYear} sửa đổi bổ sung`);
  } else if (/\b(?:thu nhap doanh nghiep|tndn)\b/.test(normalized)) {
    topical.push(`thuế thu nhập doanh nghiệp ${currentYear} sửa đổi bổ sung`);
  }

  return Array.from(
    new Set([
      ...currentBackboneQueries(query),
      query,
      `${query} ${currentYear} sửa đổi bổ sung thay thế`,
      ...topical,
    ]),
  ).slice(0, 7);
}
