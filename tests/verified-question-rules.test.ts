import assert from "node:assert/strict";
import test from "node:test";
import { verifiedExtraQuestionResponse } from "../lib/legal/verified-question-rules-extra.ts";
import { ensureBinaryConclusion, verifiedQuestionResponse } from "../lib/legal/verified-question-rules.ts";
import type { TaxSearchResponse } from "../lib/legal/types.ts";

function verified(query: string) {
  const result = verifiedExtraQuestionResponse(query) ?? verifiedQuestionResponse(query);
  assert.ok(result, `Expected a verified answer for: ${query}`);
  return result;
}

test("broad 2026 registration questions return a current overview", () => {
  const result = verified("Quy định đăng ký thuế trong năm 2026 như thế nào?");
  assert.match(result.direct_answer, /01\/07\/2026/);
  assert.match(result.direct_answer, /90\/2026\/TT-BTC/);
  assert.match(result.direct_answer, /thay thế Thông tư số 86\/2024\/TT-BTC/);
  assert.ok(result.candidates?.some((candidate) => candidate.number === "108/2025/QH15"));
});

test("cross-province address changes return a clear no", () => {
  const result = verified("Doanh nghiệp chuyển địa chỉ sang tỉnh khác có phải hoàn thành nghĩa vụ thuế tại nơi chuyển đi trước không?");
  assert.match(result.direct_answer, /^Không\./);
  assert.ok(result.candidates?.some((candidate) => candidate.number === "90/2026/TT-BTC"));
});

test("foreign platform suppliers receive a conditional registration answer", () => {
  const result = verified("Tổ chức nước ngoài bán hàng qua nền tảng thương mại điện tử tại Việt Nam có phải đăng ký thuế không?");
  assert.match(result.direct_answer, /^Có,/);
  assert.match(result.direct_answer, /khấu trừ và nộp thay/);
  assert.ok(result.candidates?.some((candidate) => candidate.number === "252/2026/NĐ-CP"));
});

test("household business information changes use Circular 90", () => {
  const result = verified("Hộ kinh doanh thay đổi thông tin đăng ký thuế thì thực hiện như thế nào từ ngày 1/7/2026?");
  assert.match(result.direct_answer, /90\/2026\/TT-BTC/);
});

test("current rental registration question returns a clear yes", () => {
  const result = verified("Cho thuê nhà dưới 100 triệu thì có cần đăng ký thuế không?");
  assert.match(result.direct_answer, /^Có\./);
  assert.match(result.direct_answer, /không phải nộp thuế GTGT và thuế TNCN/);
  assert.ok(result.candidates?.some((candidate) => candidate.number === "141/2026/NĐ-CP"));
});

test("historical rental questions stay in the ordinary retrieval flow", () => {
  assert.equal(verifiedExtraQuestionResponse("Năm 2024 cho thuê nhà 100 triệu có cần đăng ký thuế không?"), null);
  assert.equal(verifiedQuestionResponse("Năm 2024 cho thuê nhà 100 triệu có cần đăng ký thuế không?"), null);
});

test("household business below one billion gets a clear tax answer", () => {
  const result = verified("Hộ kinh doanh doanh thu 800 triệu đồng trong năm 2026 có phải nộp thuế GTGT và TNCN không?");
  assert.match(result.direct_answer, /^Không\./);
  assert.ok(result.candidates?.some((candidate) => candidate.number === "141/2026/NĐ-CP"));
});

test("cash-register invoice is not the only permitted option", () => {
  const result = verified("Hộ kinh doanh doanh thu 1,2 tỷ đồng một năm có bắt buộc dùng hóa đơn điện tử khởi tạo từ máy tính tiền không?");
  assert.match(result.direct_answer, /^Không nhất thiết/);
  assert.match(result.direct_answer, /hóa đơn điện tử có mã/);
});

test("household businesses below threshold still report revenue", () => {
  const result = verified("Hộ kinh doanh có doanh thu dưới 1 tỷ đồng có phải kê khai doanh thu với cơ quan thuế không?");
  assert.match(result.direct_answer, /^Có\./);
  assert.match(result.direct_answer, /01\/TKN-CNKD/);
});

test("rental real estate is an invoice exception", () => {
  const result = verified("Cá nhân cho thuê bất động sản có phải sử dụng hóa đơn điện tử không?");
  assert.match(result.direct_answer, /^Không\./);
  assert.ok(result.candidates?.some((candidate) => candidate.number === "254/2026/NĐ-CP"));
});

test("security deposits do not require an immediate invoice", () => {
  const result = verified("Thu tiền đặt cọc để bảo đảm thực hiện hợp đồng dịch vụ có phải lập hóa đơn điện tử ngay không?");
  assert.match(result.direct_answer, /^Không,/);
});

test("buyer digital signatures are generally not mandatory", () => {
  const result = verified("Hóa đơn điện tử có bắt buộc phải có chữ ký số của người mua không?");
  assert.match(result.direct_answer, /^Không\./);
});

test("existing coded invoice users need not add cash-register invoices", () => {
  const result = verified("Doanh nghiệp đã đăng ký hóa đơn điện tử có mã có bắt buộc đăng ký thêm hóa đơn điện tử khởi tạo từ máy tính tiền không?");
  assert.match(result.direct_answer, /^Không\./);
});

test("night shift invoices may be issued next working day in the specified case", () => {
  const result = verified("Bán hàng trong ca đêm mà không có phần mềm lập hóa đơn tự động thì có được lập hóa đơn vào ngày làm việc tiếp theo không?");
  assert.match(result.direct_answer, /^Có\./);
});

test("tax debt exit restriction answer is conditional", () => {
  const result = verified("Cá nhân nợ thuế có bị tạm hoãn xuất cảnh không?");
  assert.match(result.direct_answer, /^Có thể/);
  assert.match(result.direct_answer, /không phải mọi cá nhân/);
});

test("new enterprises under the threshold need not provisionally pay CIT", () => {
  const result = verified("Doanh nghiệp mới thành lập dự kiến doanh thu không quá 1 tỷ đồng có phải tạm nộp thuế thu nhập doanh nghiệp không?");
  assert.match(result.direct_answer, /^Không\./);
});

test("consumer invoice reports may qualify for rewards", () => {
  const result = verified("Người tiêu dùng tố giác người bán không lập và giao hóa đơn điện tử có được khen thưởng không?");
  assert.match(result.direct_answer, /^Có thể/);
});

test("new tax administration law effective dates are stated correctly", () => {
  const result = verified("Luật Quản lý thuế mới có hiệu lực từ ngày nào và áp dụng sớm nội dung nào cho hộ kinh doanh?");
  assert.match(result.direct_answer, /01\/07\/2026/);
  assert.match(result.direct_answer, /01\/01\/2026/);
});

function baseResult(answer: string): TaxSearchResponse {
  return {
    query_normalized: "test",
    query_kind: "question",
    direct_answer: answer,
    document: null,
    candidates: [],
    warnings: [],
    confidence: 0.8,
    retrieved_at: new Date().toISOString(),
  };
}

test("yes-no questions without a conclusion are marked inconclusive", () => {
  const result = ensureBinaryConclusion(
    "Cá nhân có cần đăng ký thuế không?",
    baseResult("Điều 4 quy định hồ sơ đăng ký thuế gồm các giấy tờ sau."),
  );
  assert.match(result.direct_answer, /^Chưa thể kết luận có hay không/);
  assert.ok(result.confidence <= 0.45);
});

test("an explicit no conclusion remains unchanged", () => {
  const original = baseResult("Không. Trường hợp này không thuộc diện phải đăng ký lại.");
  const result = ensureBinaryConclusion("Có cần đăng ký lại không?", original);
  assert.equal(result.direct_answer, original.direct_answer);
});
