import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type GeminiPayload = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      webSearchQueries?: string[];
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
  error?: { message?: string };
};

export async function GET() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return NextResponse.json({ error: "missing key" }, { status: 500 });

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: "Tìm Nghị định 100/2024/NĐ-CP trên các nguồn pháp luật chính thức của Việt Nam. Ưu tiên trang chi tiết có tệp DOCX hoặc DOC tại vbpl.vn hoặc congbao.chinhphu.vn. Trả lời ngắn gọn và ghi URL nguồn chính thức tìm được.",
          }],
        }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0, maxOutputTokens: 1200 },
      }),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as GeminiPayload;
  const candidate = payload.candidates?.[0];
  return NextResponse.json(
    {
      model,
      status: response.status,
      error: payload.error?.message ?? null,
      text: candidate?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "",
      queries: candidate?.groundingMetadata?.webSearchQueries ?? [],
      chunks: candidate?.groundingMetadata?.groundingChunks ?? [],
    },
    { status: response.ok ? 200 : response.status, headers: { "cache-control": "no-store" } },
  );
}
