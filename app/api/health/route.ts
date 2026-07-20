import { NextResponse } from "next/server";
import { geminiModel, hasGeminiConfig } from "@/lib/legal/gemini";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "thue-ro-simple",
    gemini: hasGeminiConfig(),
    model: geminiModel(),
    storage: "Vercel Data Cache + IndexedDB trên thiết bị",
    database: false,
    checked_at: new Date().toISOString(),
  });
}
