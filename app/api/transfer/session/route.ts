import { NextResponse } from "next/server";
import { transferMailboxId, validTransferKey } from "@/lib/transfer/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { key?: unknown };
  const key = typeof body.key === "string" ? body.key : "";
  if (!validTransferKey(key)) {
    return NextResponse.json({ error: "Mã kết nối phải có ít nhất 20 ký tự." }, { status: 400 });
  }
  return NextResponse.json(
    { ok: true, mailbox_id: transferMailboxId(key) },
    { headers: { "cache-control": "no-store" } },
  );
}
