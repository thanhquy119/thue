import { NextResponse } from "next/server";
import {
  analyzeTaxQuestion,
  clarificationForTaxQuestion,
  enrichTaxQuestion,
} from "@/lib/legal/question-intelligence";
import { searchTaxLawRobust } from "@/lib/legal/robust-search";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const GROUPS: Record<string, string[]> = {
  registration: [
    "Quy định đăng ký thuế trong năm 2026 như thế nào?",
    "Doanh nghiệp chuyển địa chỉ sang tỉnh khác có phải hoàn thành nghĩa vụ thuế tại nơi chuyển đi trước không?",
    "Tổ chức nước ngoài bán hàng qua nền tảng thương mại điện tử tại Việt Nam có phải đăng ký thuế không?",
    "Hộ kinh doanh thay đổi thông tin đăng ký thuế thì thực hiện như thế nào từ ngày 1/7/2026?",
  ],
  household: [
    "Hộ kinh doanh doanh thu 800 triệu đồng trong năm 2026 có phải nộp thuế GTGT và TNCN không?",
    "Hộ kinh doanh doanh thu 1,2 tỷ đồng một năm có bắt buộc dùng hóa đơn điện tử khởi tạo từ máy tính tiền không?",
    "Hộ kinh doanh có doanh thu dưới 1 tỷ đồng có phải kê khai doanh thu với cơ quan thuế không?",
    "Cá nhân cho thuê bất động sản có phải sử dụng hóa đơn điện tử không?",
  ],
  invoice: [
    "Thu tiền đặt cọc để bảo đảm thực hiện hợp đồng dịch vụ có phải lập hóa đơn điện tử ngay không?",
    "Hóa đơn điện tử có bắt buộc phải có chữ ký số của người mua không?",
    "Doanh nghiệp đã đăng ký hóa đơn điện tử có mã có bắt buộc đăng ký thêm hóa đơn điện tử khởi tạo từ máy tính tiền không?",
    "Bán hàng trong ca đêm mà không có phần mềm lập hóa đơn tự động thì có được lập hóa đơn vào ngày làm việc tiếp theo không?",
  ],
  administration: [
    "Cá nhân nợ thuế có bị tạm hoãn xuất cảnh không?",
    "Doanh nghiệp mới thành lập dự kiến doanh thu không quá 1 tỷ đồng có phải tạm nộp thuế thu nhập doanh nghiệp không?",
    "Người tiêu dùng tố giác người bán không lập và giao hóa đơn điện tử có được khen thưởng không?",
    "Luật Quản lý thuế mới có hiệu lực từ ngày nào và áp dụng sớm nội dung nào cho hộ kinh doanh?",
  ],
};

async function runQuestion(question: string) {
  const plan = analyzeTaxQuestion(question);
  const clarification = clarificationForTaxQuestion(question, plan);
  if (clarification) {
    return {
      question,
      mode: "clarification",
      answer: clarification,
      document: null,
      candidates: [],
      warnings: [],
      confidence: 0.3,
    };
  }

  const result = await searchTaxLawRobust(enrichTaxQuestion(question, plan), question);
  return {
    question,
    mode: "answer",
    answer: result.direct_answer.slice(0, 1800),
    document: result.document?.number ?? null,
    candidates: result.candidates.map((candidate) => candidate.number),
    warnings: result.warnings,
    confidence: result.confidence,
  };
}

export async function GET(request: Request) {
  const group = new URL(request.url).searchParams.get("group") || "registration";
  const questions = GROUPS[group];
  if (!questions) return NextResponse.json({ error: "Unknown group" }, { status: 400 });
  const settled = await Promise.allSettled(questions.map(runQuestion));
  return NextResponse.json({
    group,
    results: settled.map((item, index) =>
      item.status === "fulfilled"
        ? item.value
        : { question: questions[index], error: item.reason instanceof Error ? item.reason.message : String(item.reason) },
    ),
  }, { headers: { "cache-control": "no-store" } });
}
