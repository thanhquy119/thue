import { randomUUID } from "node:crypto";
import { del, get, put } from "@vercel/blob";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET() {
  const nonce = randomUUID();
  const pathname = `transfers/_health/${nonce}.json`;
  try {
    await put(pathname, JSON.stringify({ nonce }), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "application/json; charset=utf-8",
      cacheControlMaxAge: 60,
    });
    const stored = await get(pathname, { access: "private", useCache: false });
    if (!stored || stored.statusCode !== 200) throw new Error("Không đọc lại được file kiểm tra riêng tư.");
    const payload = JSON.parse(await new Response(stored.stream).text()) as { nonce?: string };
    if (payload.nonce !== nonce) throw new Error("Nội dung file kiểm tra riêng tư không khớp.");
    return NextResponse.json(
      { ok: true, private_storage: true },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        private_storage: false,
        error: error instanceof Error ? error.message : "Kiểm tra kho file riêng tư thất bại.",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  } finally {
    await del(pathname).catch(() => undefined);
  }
}
