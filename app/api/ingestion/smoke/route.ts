import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getRun, start } from "workflow/api";
import {
  durableStoreConfigured,
  readDurableIngestionState,
  verifyDurableStore,
} from "@/lib/legal/durable-document-store";
import { discoverTaxDocumentByNumber } from "@/lib/legal/recent-tax-discovery";
import { legalDocumentIngestionWorkflow } from "@/workflows/legal-document-ingestion";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const OCR_252_SOURCE = {
  number: "252/2026/NĐ-CP",
  title: "Nghị định số 252/2026/NĐ-CP quy định chi tiết một số điều và biện pháp để tổ chức, hướng dẫn thi hành Luật Quản lý thuế",
  type: "Nghị định",
  issuer: "Chính phủ",
  issuedDate: "2026-06-30",
  effectiveDate: "2026-07-01",
  officialPageUrl: "https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-dinh-252-2026-nd-cp-huong-dan-thi-hanh-luat-quan-ly-thue-119260715155021635.htm",
  sourceUrl: "https://xdcs.cdnchinhphu.vn/446259493575335936/2026/7/15/252-ndcp-signed-17841052430171897600672.pdf",
  sourceLabel: "Cổng Thông tin điện tử Chính phủ",
};

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

async function statusResponse(runId: string) {
  try {
    const run = await getRun(runId);
    const [status, workflowName, createdAt, startedAt, completedAt, returnValue] = await Promise.all([
      run.status,
      run.workflowName,
      run.createdAt,
      run.startedAt,
      run.completedAt,
      run.returnValue.catch(() => null),
    ]);
    return NextResponse.json(
      {
        run_id: runId,
        status,
        workflow_name: workflowName,
        created_at: toIso(createdAt),
        started_at: toIso(startedAt),
        completed_at: toIso(completedAt),
        return_value: returnValue,
      },
      { headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } },
    );
  } catch {
    return NextResponse.json({ error: `Không tìm thấy workflow run ${runId}.` }, { status: 404 });
  }
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV === "production") {
    return new Response(null, { status: 404 });
  }
  const url = new URL(request.url);
  const runId = url.searchParams.get("run_id")?.trim() ?? "";
  if (runId) return statusResponse(runId);

  if (url.searchParams.get("check") === "storage") {
    const result = await verifyDurableStore();
    return NextResponse.json(result, {
      status: result.ok ? 200 : 503,
      headers: { "cache-control": "no-store", "x-robots-tag": "noindex" },
    });
  }

  const smokeCase = url.searchParams.get("case")?.trim() ?? "";
  const fullOcr94 = smokeCase === "full-ocr-94";
  const revalidateOcr94 = smokeCase === "revalidate-ocr-94";
  const fullOcr252 = smokeCase === "full-ocr-252";
  const revalidateOcr252 = smokeCase === "revalidate-ocr-252";
  const number = fullOcr252 || revalidateOcr252
    ? OCR_252_SOURCE.number
    : fullOcr94 || revalidateOcr94
      ? "94/2026/TT-BTC"
      : url.searchParams.get("number")?.trim().slice(0, 100) ?? "";
  const sourceUrl = url.searchParams.get("source_url")?.trim() ?? "";
  if (!number) {
    return NextResponse.json({ error: "Thiếu number." }, { status: 400 });
  }

  const persist = fullOcr94 || revalidateOcr94 || fullOcr252 || revalidateOcr252 || url.searchParams.get("persist") === "1";
  if (persist && !durableStoreConfigured()) {
    return NextResponse.json(
      { error: "Vercel Blob chưa được cấu hình cho Preview." },
      { status: 503 },
    );
  }

  const customSource = fullOcr252 || revalidateOcr252
    ? OCR_252_SOURCE
    : sourceUrl
      ? {
          number,
          title: url.searchParams.get("title")?.trim() || `Văn bản số ${number}`,
          type: /\/TT-/iu.test(number) ? "Thông tư" : /\/NĐ-CP$/iu.test(number) ? "Nghị định" : "Văn bản pháp luật",
          issuer: /TT-BTC$/iu.test(number) ? "Bộ Tài chính" : /NĐ-CP$/iu.test(number) ? "Chính phủ" : "",
          issuedDate: url.searchParams.get("issued_date")?.trim() || null,
          effectiveDate: url.searchParams.get("effective_date")?.trim() || null,
          officialPageUrl: url.searchParams.get("official_page_url")?.trim() || sourceUrl,
          sourceUrl,
          sourceLabel: "Nguồn smoke test được chỉ định trên Preview",
        }
      : null;
  const discovered = customSource ? null : await discoverTaxDocumentByNumber(number).catch(() => null);
  const source = customSource ?? discovered;
  if (!source) {
    return NextResponse.json({ error: `Không tìm thấy nguồn chính xác ${number}.` }, { status: 404 });
  }

  let jobId: string = randomUUID();
  let reuseExistingCheckpoints = false;
  if (revalidateOcr94 || revalidateOcr252) {
    const existing = await readDurableIngestionState(number);
    const expectedPages = revalidateOcr252 ? 133 : 35;
    if (!existing?.runId || existing.totalPages !== expectedPages || existing.processedPages !== expectedPages) {
      return NextResponse.json(
        { error: `Chưa có đủ checkpoint ${expectedPages}/${expectedPages} trang để revalidate ${number}.` },
        { status: 409 },
      );
    }
    jobId = existing.runId;
    reuseExistingCheckpoints = true;
  }

  const run = await start(legalDocumentIngestionWorkflow, [{
    jobId,
    source,
    persist,
    reuseExistingCheckpoints,
  }]);
  return NextResponse.json(
    {
      ok: true,
      job_id: jobId,
      run_id: run.runId,
      number: source.number,
      source_url: source.sourceUrl,
      persist,
      reuse_existing_checkpoints: reuseExistingCheckpoints,
      smoke_case: smokeCase || null,
    },
    { status: 202, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } },
  );
}
