import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {POST as search} from "@/app/api/search/route";
import {publicLegalVideoJob, readLegalVideoJob} from "@/lib/video/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = {params: Promise<{token: string}>};

const REGRESSION_QUERIES = [
  "Công ty mua Hàng hóa nhập khẩu được khấu trừ thuế đầu vào không",
  "Trường hợp người nộp thuế không còn nợ thuế nhưng chưa hoàn thành thủ tục chấm dứt hiệu lực max số thuế thì từ chối xác nhận không nợ theo quy định nào",
  "Hướng dẫn chi tiết về việc người nộp thuế trạng tái không hoạt động tại địa chỉ đăng ký không xác nhận nợ thuế theo quy định nào",
] as const;

function expectedToken() {
  return createHash("sha256")
    .update(`legal-e2e-report:${process.env.VERCEL_DEPLOYMENT_ID || "local"}:verified-tax-video`)
    .digest("hex")
    .slice(0, 24);
}

async function runSearch(request: Request, query: string) {
  const internal = new Request(new URL("/api/search", request.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Thue-Ro-e2e-report",
      "x-forwarded-for": "127.0.0.1",
    },
    body: JSON.stringify({query}),
  });
  const response = await search(internal);
  return {
    status: response.status,
    body: await response.json(),
  };
}

export async function GET(request: Request, context: RouteContext) {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({error: "Báo cáo E2E không chạy ở production."}, {status: 404});
  }

  const {token} = await context.params;
  if (token !== expectedToken()) {
    return NextResponse.json({error: "Token báo cáo không hợp lệ."}, {status: 401});
  }

  const queryResults = [];
  for (const query of REGRESSION_QUERIES) {
    queryResults.push({query, ...(await runSearch(request, query))});
  }

  const jobId = new URL(request.url).searchParams.get("jobId")?.trim() || "";
  const job = /^[0-9a-f-]{20,64}$/iu.test(jobId) ? await readLegalVideoJob(jobId) : null;

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      queries: queryResults,
      videoJob: job ? publicLegalVideoJob(job) : null,
    },
    {headers: {"cache-control": "no-store"}},
  );
}
