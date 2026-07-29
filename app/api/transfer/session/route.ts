import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { transferMailboxId, validTransferKey } from "@/lib/transfer/core";
import { list, put, storageConfigured } from "@/lib/storage/r2-blob-compat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "cache-control": "no-store", "x-robots-tag": "noindex" };
const MAX_PAIRING_DEVICES = 100;

type DeviceRole = "host" | "join";

type SessionRequest = {
  key?: unknown;
  device_id?: unknown;
  role?: unknown;
};

function normalizedDeviceId(value: unknown) {
  const deviceId = typeof value === "string" ? value.trim() : "";
  return /^[a-z0-9-]{12,100}$/iu.test(deviceId) ? deviceId : "";
}

function normalizedRole(value: unknown): DeviceRole {
  return value === "host" ? "host" : "join";
}

function deviceMarkerPrefix(mailboxId: string) {
  return `transfers/${mailboxId}/pairing/devices/`;
}

function deviceMarkerPath(mailboxId: string, deviceId: string) {
  const hash = createHash("sha256").update(deviceId).digest("hex");
  return `${deviceMarkerPrefix(mailboxId)}${hash}.json`;
}

async function pairingStatus(mailboxId: string) {
  if (!storageConfigured()) return { paired: false, device_count: 0 };
  const page = await list({ prefix: deviceMarkerPrefix(mailboxId), limit: MAX_PAIRING_DEVICES });
  const deviceCount = page.blobs.filter((blob) => blob.pathname.endsWith(".json")).length;
  return { paired: deviceCount >= 2, device_count: deviceCount };
}

async function registerDevice(mailboxId: string, deviceId: string, role: DeviceRole) {
  if (!deviceId || !storageConfigured()) return;
  await put(deviceMarkerPath(mailboxId, deviceId), JSON.stringify({
    role,
    lastSeenAt: new Date().toISOString(),
  }), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    cacheControlMaxAge: 0,
    contentType: "application/json; charset=utf-8",
  });
}

function requestKey(request: Request) {
  return request.headers.get("x-transfer-key") ?? "";
}

export async function GET(request: Request) {
  try {
    const key = requestKey(request);
    if (!validTransferKey(key)) {
      return NextResponse.json({ error: "Mã kết nối không hợp lệ." }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const mailboxId = transferMailboxId(key);
    const status = await pairingStatus(mailboxId);
    return NextResponse.json({ ok: true, mailbox_id: mailboxId, ...status }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[transfer-session:get]", error);
    return NextResponse.json({ error: "Không kiểm tra được trạng thái kết nối." }, { status: 503, headers: NO_STORE_HEADERS });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as SessionRequest;
    const key = typeof body.key === "string" ? body.key : "";
    if (!validTransferKey(key)) {
      return NextResponse.json({ error: "Mã kết nối phải có ít nhất 20 ký tự." }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const mailboxId = transferMailboxId(key);
    const deviceId = normalizedDeviceId(body.device_id);
    await registerDevice(mailboxId, deviceId, normalizedRole(body.role));
    const status = await pairingStatus(mailboxId);
    return NextResponse.json({ ok: true, mailbox_id: mailboxId, ...status }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[transfer-session:post]", error);
    return NextResponse.json({ error: "Không thể ghi nhận thiết bị kết nối." }, { status: 503, headers: NO_STORE_HEADERS });
  }
}
