import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DOCUMENT_URL = "https://vanban.chinhphu.vn/?pageid=27160&docid=210760&classid=1";

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export async function GET() {
  const response = await fetch(DOCUMENT_URL, {
    cache: "no-store",
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
    },
  });
  const html = await response.text();
  const attachments = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu)]
    .map((match) => ({
      url: (() => {
        try {
          return new URL(decodeHtml(match[1]), DOCUMENT_URL).toString();
        } catch {
          return "";
        }
      })(),
      label: stripTags(match[2]),
    }))
    .filter((item) => /\.(?:pdf|docx?|rtf)(?:\?|$)/iu.test(item.url) || /tài liệu|đính kèm|toàn văn|download/iu.test(item.label));

  const unique = attachments.filter(
    (item, index, all) => item.url && all.findIndex((candidate) => candidate.url === item.url) === index,
  );

  const probes = await Promise.all(
    unique.slice(0, 12).map(async (item) => {
      try {
        const probe = await fetch(item.url, {
          method: "GET",
          cache: "no-store",
          headers: { range: "bytes=0-4095", "user-agent": "ThueRo/2.2" },
        });
        const bytes = Buffer.from(await probe.arrayBuffer());
        return {
          ...item,
          status: probe.status,
          contentType: probe.headers.get("content-type"),
          contentLength: probe.headers.get("content-length"),
          contentDisposition: probe.headers.get("content-disposition"),
          firstBytes: bytes.subarray(0, 32).toString("hex"),
        };
      } catch (error) {
        return { ...item, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );

  return NextResponse.json(
    {
      status: response.status,
      htmlLength: html.length,
      pageTextLength: stripTags(html).length,
      attachments: probes,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
