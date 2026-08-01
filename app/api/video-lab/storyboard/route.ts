import { NextResponse } from "next/server";
import {
  VIDEO_PLAN_SCHEMA,
  buildFallbackVideoPlan,
  buildOllamaMessages,
  validateVideoPlan,
} from "@/lib/video/storyboard";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_SOURCE_LENGTH = 80_000;

type RequestBody = {
  text?: unknown;
  title?: unknown;
};

type OllamaPayload = {
  message?: { content?: unknown };
  error?: unknown;
};

function cleanTitle(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, 140) : undefined;
}

async function requestOllama(text: string, title?: string) {
  const endpoint = process.env.VIDEO_OLLAMA_URL?.trim();
  if (!endpoint) return null;
  const model = process.env.VIDEO_OLLAMA_MODEL?.trim() || "qwen3:8b";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 105_000);
  try {
    const response = await fetch(`${endpoint.replace(/\/$/u, "")}/api/chat`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        model,
        stream: false,
        format: VIDEO_PLAN_SCHEMA,
        messages: buildOllamaMessages(text, title),
        options: { temperature: 0, num_ctx: 32_768 },
      }),
    });
    const payload = await response.json().catch(() => ({})) as OllamaPayload;
    if (!response.ok) {
      throw new Error(typeof payload.error === "string" ? payload.error : `Ollama trả lỗi ${response.status}.`);
    }
    const content = payload.message?.content;
    if (typeof content !== "string") throw new Error("Ollama không trả về nội dung JSON.");
    const parsed = JSON.parse(content) as unknown;
    const plan = validateVideoPlan(parsed);
    if (!plan) throw new Error("Storyboard từ Ollama không đúng schema.");
    return { plan, model };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as RequestBody;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const title = cleanTitle(body.title);
  if (text.length < 120) {
    return NextResponse.json({ error: "Cần ít nhất 120 ký tự để tạo bản tóm tắt có ý nghĩa." }, { status: 400 });
  }
  if (text.length > MAX_SOURCE_LENGTH) {
    return NextResponse.json({ error: `Bản thử giới hạn ${MAX_SOURCE_LENGTH.toLocaleString("vi-VN")} ký tự mỗi lượt.` }, { status: 413 });
  }

  try {
    const result = await requestOllama(text, title);
    if (result) {
      return NextResponse.json({ plan: result.plan, engine: `ollama:${result.model}`, warning: null });
    }
  } catch (error) {
    const warning = error instanceof Error ? error.message : "Không gọi được Ollama.";
    return NextResponse.json({
      plan: buildFallbackVideoPlan(text, title),
      engine: "fallback-extractive",
      warning: `${warning} Đã dùng bộ trích xuất an toàn để em vẫn kiểm thử được giao diện.`,
    });
  }

  return NextResponse.json({
    plan: buildFallbackVideoPlan(text, title),
    engine: "fallback-extractive",
    warning: "Preview Vercel không chạy Ollama. Khi chạy local, đặt VIDEO_OLLAMA_URL để thử model thật.",
  });
}
