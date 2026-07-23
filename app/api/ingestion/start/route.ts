import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { discoverTaxDocumentByNumber } from "@/lib/legal/recent-tax-discovery";
import { durableStoreConfigured, durableStoreAccess } from "@/lib/legal/durable-document-store";
import { legalDocumentIngestionWorkflow } from "@/workflows/legal-document-ingestion";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type StartBody = {
  number?: unknown;
  source_url?: unknown;
  title?: unknown;
  issued_date?: unknown;
  dry_run?: unknown;
};

function authorized(request: Request) {
  const secret = process.env.INGESTION_ADMIN_SECRET || process.env.CRON_SECRET || "";
  if (!secret) return process.env.VERCEL_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    workflow: true,
    blob: durableStoreConfigured(),
    blob_access: durableStoreAccess(),
    max_source_bytes: Number(process.env.LEGAL_MAX_SOURCE_BYTES || 100_000_000),
    ocr_batch_pages: 3,
    production_manual_trigger_protected: Boolean(
      process.env.INGESTION_ADMIN_SECRET || process.env.CRON_SECRET,
    ),
  });
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Không có quyền khởi động pipeline nhập văn bản." }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as StartBody;
  const number = text(body.number).slice(0, 100);
  if (!number) {
    return NextResponse.json({ error: "Thiếu số hiệu văn bản." }, { status: 400 });
  }
  const dryRun = body.dry_run === true;
  if (!dryRun && !durableStoreConfigured()) {
    return NextResponse.json(
      {
        error: "Chưa kết nối Vercel Blob. Có thể chạy dry_run trên Preview để kiểm thử, nhưng chưa thể lưu và công bố bền vững.",
        code: "BLOB_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }

  const discovered = await discoverTaxDocumentByNumber(number).catch(() => null);
  const customUrl = text(body.source_url);
  const source = discovered ?? (customUrl
    ? {
        number,
        title: text(body.title) || `Văn bản số ${number}`,
        type: /\/TT-/iu.test(number) ? "Thông tư" : "Văn bản pháp luật",
        issuer: /TT-BTC$/iu.test(number) ? "Bộ Tài chính" : "",
        issuedDate: text(body.issued_date) || null,
        effectiveDate: null,
        officialPageUrl: customUrl,
        sourceUrl: customUrl,
        sourceLabel: "Nguồn được chỉ định để kiểm thử",
      }
    : null);
  if (!source) {
    return NextResponse.json(
      { error: `Không tìm thấy nguồn chính thức khớp chính xác ${number}.` },
      { status: 404 },
    );
  }

  const jobId = randomUUID();
  const run = await start(
    legalDocumentIngestionWorkflow,
    [{ jobId, source, persist: !dryRun }],
    { region: "iad1" },
  );
  return NextResponse.json(
    {
      ok: true,
      job_id: jobId,
      run_id: run.runId,
      number: source.number,
      source_url: source.sourceUrl,
      dry_run: dryRun,
    },
    { status: 202, headers: { "cache-control": "no-store" } },
  );
}
