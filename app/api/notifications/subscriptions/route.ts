import { NextResponse } from "next/server";
import {
  normalizePushSubscription,
  requestOriginAllowed,
} from "@/lib/notifications/push-core";
import { sendWelcomeNotification } from "@/lib/notifications/push-service";
import {
  deletePushSubscriptionByEndpoint,
  pushStoreConfigured,
  savePushSubscription,
} from "@/lib/notifications/push-store";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";

function authorizedOrigin(request: Request) {
  return requestOriginAllowed(
    request.headers.get("origin"),
    request.url,
    process.env.VERCEL_ENV === "production",
  );
}

export async function POST(request: Request) {
  if (!authorizedOrigin(request)) {
    return NextResponse.json({ error: "Nguồn yêu cầu không hợp lệ." }, { status: 403 });
  }
  if (!pushStoreConfigured()) {
    return NextResponse.json({ error: "Private Blob chưa được cấu hình." }, { status: 503 });
  }

  try {
    const body = await request.json() as { subscription?: unknown };
    const subscription = normalizePushSubscription(body.subscription ?? body);
    if (!subscription) {
      return NextResponse.json({ error: "Push subscription không hợp lệ." }, { status: 400 });
    }

    const stored = await savePushSubscription(subscription);
    const welcome = await sendWelcomeNotification(stored, new URL(request.url).origin);
    return NextResponse.json(
      {
        ok: true,
        subscribed: true,
        welcome_sent: welcome.sent,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không lưu được thiết bị nhận thông báo." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function DELETE(request: Request) {
  if (!authorizedOrigin(request)) {
    return NextResponse.json({ error: "Nguồn yêu cầu không hợp lệ." }, { status: 403 });
  }
  if (!pushStoreConfigured()) {
    return NextResponse.json({ error: "Private Blob chưa được cấu hình." }, { status: 503 });
  }

  try {
    const body = await request.json() as { endpoint?: unknown };
    if (typeof body.endpoint !== "string" || !body.endpoint.trim()) {
      return NextResponse.json({ error: "Thiếu endpoint cần hủy." }, { status: 400 });
    }
    const endpoint = new URL(body.endpoint.trim());
    if (endpoint.protocol !== "https:") {
      return NextResponse.json({ error: "Endpoint không hợp lệ." }, { status: 400 });
    }
    await deletePushSubscriptionByEndpoint(endpoint.toString());
    return NextResponse.json(
      { ok: true, subscribed: false },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không hủy được thông báo." },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
