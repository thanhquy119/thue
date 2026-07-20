import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type GeminiPayload = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; groundingMetadata?: unknown }>;
  error?: { message?: string };
};

async function tryModel(model: string) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40_000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Tra cứu trên Cơ sở dữ liệu quốc gia về văn bản pháp luật (vbpl.vn) và trả JSON duy nhất cho các số hiệu 89/2024/TT-BTC, 89/2021/TT-BTC, 89/2019/TT-BTC, 89/2017/TT-BTC, 89/2016/TTLT-BTC-BCT. Mỗi phần tử gồm number và status chỉ nhận effective, partially_effective, expired, unknown. Không thêm markdown." }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0, maxOutputTokens: 1_000 },
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as GeminiPayload;
    return {
      model,
      status: response.status,
      text: (payload.candidates?.[0]?.content?.parts ?? []).map((part) => part.text || "").join("\n"),
      hasGrounding: Boolean(payload.candidates?.[0]?.groundingMetadata),
      error: payload.error?.message || null,
    };
  } catch (error) {
    return { model, status: 0, text: "", hasGrounding: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const results = [];
  for (const model of ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"]) {
    const result = await tryModel(model);
    results.push(result);
    if (result.status === 200 && result.text) break;
  }
  console.log("GROUNDED_STATUS_PROBE", JSON.stringify(results));
  return NextResponse.json({ results });
}
