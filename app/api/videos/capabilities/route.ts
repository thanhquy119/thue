import {NextResponse} from "next/server";
import {legalVideoCapabilities} from "@/lib/video/capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(legalVideoCapabilities(), {
    headers: {"cache-control": "no-store"},
  });
}
