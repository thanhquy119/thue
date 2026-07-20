import { NextResponse } from "next/server";
import { get as httpsGet } from "node:https";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SEARCH_URL = "https://vbpl.vn/TW/Pages/vbpq-timkiem.aspx?Keyword=100%2F2024%2FN%C4%90-CP";

function fetchPinned(url: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  return new Promise((resolve, reject) => {
    const request = httpsGet(
      url,
      {
        rejectUnauthorized: false,
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
          "accept-language": "vi-VN,vi;q=0.9,en;q=0.5",
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 8_000_000) {
            request.destroy(new Error("too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
        response.on("error", reject);
      },
    );
    request.setTimeout(20_000, () => request.destroy(new Error("timeout")));
    request.on("error", reject);
  });
}

function decodeHtml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET() {
  try {
    const search = await fetchPinned(SEARCH_URL);
    const links = [...search.text.matchAll(/<a\b[^>]*href=["']([^"']*(?:ItemID|itemid)=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/giu)]
      .map((match) => {
        let url = "";
        try {
          url = new URL(decodeHtml(match[1]), SEARCH_URL).toString();
        } catch {}
        return { url, title: stripTags(match[2]) };
      })
      .filter((item, index, all) => item.url && all.findIndex((candidate) => candidate.url === item.url) === index)
      .slice(0, 50);

    const exact = links.find((item) => /100\s*\/\s*2024\s*\/\s*N[ĐD]-CP/iu.test(item.title));
    const itemId = exact?.url.match(/[?&]ItemID=(\d+)/i)?.[1] ?? "169712";
    const originalUrl = `https://vbpl.vn/TW/Pages/vbpq-van-ban-goc.aspx?ItemID=${itemId}`;
    const original = await fetchPinned(originalUrl);
    const attachments = [...original.text.matchAll(/(?:href|src)=["']([^"']+\.(?:docx?|pdf)(?:\?[^"']*)?)["']/giu)]
      .map((match) => {
        try {
          return new URL(decodeHtml(match[1]), originalUrl).toString();
        } catch {
          return "";
        }
      })
      .filter((value, index, all) => value && all.indexOf(value) === index)
      .slice(0, 30);

    return NextResponse.json(
      {
        searchStatus: search.status,
        searchLocation: search.headers.location ?? null,
        searchLength: search.text.length,
        exactNumberInSearch: /100\s*\/\s*2024\s*\/\s*N[ĐD]-CP/iu.test(stripTags(search.text)),
        links,
        selectedItemId: itemId,
        originalStatus: original.status,
        originalLocation: original.headers.location ?? null,
        originalLength: original.text.length,
        attachments,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: unknown }).cause : null;
    return NextResponse.json(
      {
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        cause,
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
