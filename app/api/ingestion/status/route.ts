import { NextResponse } from "next/server";
import {
  durableStoreAccess,
  durableStoreConfigured,
  readDurableIngestionState,
  readDurableRevision,
} from "@/lib/legal/durable-document-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const number = new URL(request.url).searchParams.get("number")?.trim() ?? "";
  if (!number) {
    return NextResponse.json({ error: "Thiếu tham số number." }, { status: 400 });
  }
  if (!durableStoreConfigured()) {
    return NextResponse.json(
      {
        number,
        configured: false,
        access: durableStoreAccess(),
        status: null,
        revision: null,
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  const [status, revision] = await Promise.all([
    readDurableIngestionState(number),
    readDurableRevision(number),
  ]);
  return NextResponse.json(
    {
      number,
      configured: true,
      access: durableStoreAccess(),
      status,
      revision: revision
        ? {
            revision_id: revision.revisionId,
            source_sha256: revision.sourceSha256,
            source_blob_url: revision.sourceBlobUrl,
            published_at: revision.publishedAt,
            validation: revision.validation,
            document: {
              number: revision.document.number,
              title: revision.document.title,
              issuer: revision.document.issuer,
              issued_date: revision.document.issued_date,
              effective_date: revision.document.effective_date,
              extraction_method: revision.document.extraction_method,
              quality_score: revision.document.quality_score,
              characters: revision.document.official_text.length,
              provisions: revision.document.provisions.length,
            },
          }
        : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
