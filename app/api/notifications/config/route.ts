import { NextResponse } from "next/server";
import { ensureVapidConfig } from "@/lib/notifications/push-service";
import { pushStoreConfigured } from "@/lib/notifications/push-store";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!pushStoreConfigured()) {
    return NextResponse.json(
      {
        enabled: false,
        publicKey: null,
        reason: "Private Blob chưa được cấu hình.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const config = await ensureVapidConfig(new URL(request.url).origin);
    return NextResponse.json(
      {
        enabled: Boolean(config?.publicKey),
        publicKey: config?.publicKey ?? null,
        reason: config ? null : "Web Push chưa sẵn sàng.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        enabled: false,
        publicKey: null,
        reason: error instanceof Error ? error.message : "Không khởi tạo được Web Push.",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
