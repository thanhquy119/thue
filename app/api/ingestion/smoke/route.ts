import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { discoverTaxDocumentByNumber } from "@/lib/legal/recent-tax-discovery";
import { legalDocumentIngestionWorkflow } from "@/workflows/legal-document-ingestion";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV === "production") {
    return new Response(null, { status: 404 });
  }
  const url = new URL(request.url);
  const number = url.searchParams.get("number")?.trim().slice(0, 100) ?? "";
  const sourceUrl = url.searchParams.get("source_url")?.trim() ?? "";
  if (!number) {
    return NextResponse.json({ error: "Thiếu number." }, { status: 400 });
  }

  const discovered = await discoverTaxDocumentByNumber(number).catch(() => null);
  const source = discovered ?? (sourceUrl
    ? {
        number,
        title: url.searchParams.get("title")?.trim() || `Văn bản số ${number}`,
        type: /\/TT-/iu.test(number) ? "Thông tư" : "Văn bản pháp luật",
        issuer: /TT-BTC$/iu.test(number) ? "Bộ Tài chính" : "",
        issuedDate: url.searchParams.get("issued_date")?.trim() || null,
        effectiveDate: null,
        officialPageUrl: sourceUrl,
        sourceUrl,
        sourceLabel: "Nguồn smoke test trên Preview",
      }
    : null);
  if (!source) {
    return NextResponse.json({ error: `Không tìm thấy nguồn chính xác ${number}.` }, { status: 404 });
  }

  const jobId = randomUUID();
  const run = await start(legalDocumentIngestionWorkflow, [{ jobId, source, persist: false }]);
  return NextResponse.json(
    {
      ok: true,
      job_id: jobId,
      run_id: run.runId,
      number: source.number,
      source_url: source.sourceUrl,
      persist: false,
    },
    { status: 202, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } },
  );
}
