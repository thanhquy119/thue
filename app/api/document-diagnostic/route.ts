import { looksLikeGovernmentPortalShell } from "@/lib/legal/document-quality";
import { recentVerifiedDocumentResponse } from "@/lib/legal/recent-verified-documents";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function summarize(number: string) {
  const result = await recentVerifiedDocumentResponse(number);
  const document = result?.document ?? null;
  return {
    query: number,
    direct_answer: result?.direct_answer ?? null,
    warnings: result?.warnings ?? [],
    confidence: result?.confidence ?? 0,
    document: document
      ? {
          number: document.number,
          title: document.title,
          issuer: document.issuer,
          issued_date: document.issued_date,
          effective_date: document.effective_date,
          source_url: document.source_url,
          extraction_method: document.extraction_method,
          quality_score: document.quality_score,
          verification_notes: document.verification_notes,
          characters: document.official_text.length,
          provisions: document.provisions.length,
          portal_shell: looksLikeGovernmentPortalShell(document.official_text),
          opening: document.official_text.slice(0, 1_500),
        }
      : null,
    candidates: result?.candidates ?? [],
  };
}

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("number")?.trim() ?? "all";
  const numbers = requested === "all" ? ["90/2026/TT-BTC", "94/2026/TT-BTC"] : [requested];
  const results = [];
  for (const number of numbers) results.push(await summarize(number));

  return Response.json(
    { results },
    { headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } },
  );
}
