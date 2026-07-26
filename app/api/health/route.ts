import { NextResponse } from "next/server";
import { geminiModel, hasGeminiConfig } from "@/lib/legal/gemini";
import {
  searchGroundingBackoffActive,
  searchGroundingEnabled,
  searchGroundingMaxResults,
  searchGroundingMode,
  searchGroundingModel,
  searchGroundingUsable,
} from "@/lib/legal/search-grounding-fallback";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "thue-ro-simple",
    gemini: hasGeminiConfig(),
    model: geminiModel(),
    search_grounding: {
      mode: searchGroundingMode(),
      enabled: searchGroundingEnabled(),
      usable: searchGroundingUsable(),
      model: searchGroundingModel(),
      max_results: searchGroundingMaxResults(),
      backoff_active: searchGroundingBackoffActive(),
    },
    storage: "Vercel Data Cache + IndexedDB trên thiết bị",
    database: false,
    checked_at: new Date().toISOString(),
  });
}
