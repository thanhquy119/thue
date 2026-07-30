import { after, NextResponse } from "next/server";
import { validTransferKey, type TransferFileRecord } from "@/lib/transfer/core";
import { readTransferredFile, reprocessTransferredPdf } from "@/lib/transfer/store";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "cache-control": "no-store", "x-robots-tag": "noindex" };
const BACKGROUND_BUDGET_MS = 235_000;
const BACKGROUND_HANDOFF_MARGIN_MS = 25_000;
const BACKGROUND_PROCESSING_POLL_MS = 8_000;
const BACKGROUND_MAX_HOLD_MS = 185_000;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableFailure(meta: TransferFileRecord) {
  return meta.status === "failed" && /429|quota|rate limit|resource exhausted|too many requests|quá thời gian|timeout|fetch failed|network/iu.test(meta.error ?? "");
}

function needsBackgroundOcr(meta: TransferFileRecord) {
  if (meta.status === "ready") return false;
  if (meta.status === "failed" && !retryableFailure(meta)) return false;
  const isPdf = meta.contentType.includes("pdf") || meta.name.toLocaleLowerCase("en").endsWith(".pdf");
  if (!isPdf) return false;
  return meta.status === "processing" || meta.status === "ocr_partial" || retryableFailure(meta) ||
    (meta.extractionMethod === "pdf_ocr" && meta.processedPages < meta.totalPages);
}

function nextDelay(meta: TransferFileRecord) {
  const retryAt = meta.nextOcrAttemptAt ? Date.parse(meta.nextOcrAttemptAt) : Number.NaN;
  if (Number.isFinite(retryAt) && retryAt > Date.now()) return retryAt - Date.now();
  return meta.status === "processing" ? BACKGROUND_PROCESSING_POLL_MS : 0;
}

function logResult(fileId: string, result: Awaited<ReturnType<typeof reprocessTransferredPdf>>) {
  if (!result) return;
  console.info("[transfer-ocr-result]", JSON.stringify({
    fileId,
    status: result.meta.status,
    processedPages: result.meta.processedPages,
    totalPages: result.meta.totalPages,
    nextOcrAttemptAt: result.meta.nextOcrAttemptAt ?? null,
    error: result.meta.error ?? null,
  }));
}

async function handoffBackgroundOcr(requestUrl: string, key: string, fileId: string) {
  const endpoint = new URL(`/api/transfer/files/${encodeURIComponent(fileId)}/process`, requestUrl);
  endpoint.searchParams.set("background", "1");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "x-transfer-key": key },
    cache: "no-store",
  });
  if (!response.ok && response.status !== 202) {
    console.error("[transfer-ocr-handoff]", JSON.stringify({ fileId, status: response.status }));
  }
}

async function runBackgroundOcr(requestUrl: string, key: string, fileId: string) {
  const startedAt = Date.now();
  try {
    while (Date.now() - startedAt < BACKGROUND_BUDGET_MS - BACKGROUND_HANDOFF_MARGIN_MS) {
      const current = await readTransferredFile(key, fileId);
      if (!current || !needsBackgroundOcr(current.meta)) return;

      const delay = nextDelay(current.meta);
      if (delay > 0) {
        const remaining = BACKGROUND_BUDGET_MS - BACKGROUND_HANDOFF_MARGIN_MS - (Date.now() - startedAt);
        if (remaining <= 0) break;
        const hold = Math.min(delay, BACKGROUND_MAX_HOLD_MS, remaining);
        await wait(hold);
        if (hold < delay) break;
      }

      const result = await reprocessTransferredPdf(key, fileId);
      logResult(fileId, result);
      if (!result || !needsBackgroundOcr(result.meta)) return;
    }
  } catch (error) {
    console.error("[transfer-ocr-background]", JSON.stringify({
      fileId,
      message: error instanceof Error ? error.message : String(error),
    }));
  }

  const latest = await readTransferredFile(key, fileId).catch(() => null);
  if (latest && needsBackgroundOcr(latest.meta)) {
    await handoffBackgroundOcr(requestUrl, key, fileId).catch((error) => {
      console.error("[transfer-ocr-handoff]", JSON.stringify({
        fileId,
        message: error instanceof Error ? error.message : String(error),
      }));
    });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  const key = request.headers.get("x-transfer-key") ?? "";
  if (!validTransferKey(key)) {
    return NextResponse.json({ error: "Mã kết nối không hợp lệ." }, { status: 401 });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Yêu cầu khác nguồn đã bị chặn." }, { status: 403 });
  }
  const { fileId } = await context.params;
  if (!/^[a-z0-9-]{12,80}$/iu.test(fileId)) {
    return NextResponse.json({ error: "Mã file không hợp lệ." }, { status: 400 });
  }

  try {
    const background = new URL(request.url).searchParams.get("background") === "1";
    if (background) {
      const current = await readTransferredFile(key, fileId);
      if (!current) return NextResponse.json({ error: "Không tìm thấy file." }, { status: 404, headers: NO_STORE_HEADERS });
      if (needsBackgroundOcr(current.meta)) {
        after(async () => runBackgroundOcr(request.url, key, fileId));
      }
      return NextResponse.json(current, {
        status: current.meta.status === "ready" ? 200 : needsBackgroundOcr(current.meta) ? 202 : 422,
        headers: NO_STORE_HEADERS,
      });
    }

    const result = await reprocessTransferredPdf(key, fileId);
    if (!result) return NextResponse.json({ error: "Không tìm thấy file." }, { status: 404, headers: NO_STORE_HEADERS });
    logResult(fileId, result);
    if (needsBackgroundOcr(result.meta)) {
      after(async () => runBackgroundOcr(request.url, key, fileId));
    }
    const status = result.meta.status === "ready"
      ? 200
      : result.meta.status === "processing" || result.meta.status === "ocr_partial"
        ? 202
        : 422;
    return NextResponse.json(result, { status, headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể tiếp tục OCR PDF.";
    console.error("[transfer-ocr-route]", JSON.stringify({ fileId, message }));
    const missingLegacyObject = /Vercel Blob.*403|Failed to fetch blob: 403|store has been suspended/iu.test(message);
    return NextResponse.json(
      { error: missingLegacyObject ? "File cũ không còn trong kho. Vui lòng dùng file vừa tải lại." : message },
      { status: missingLegacyObject ? 404 : 503, headers: NO_STORE_HEADERS },
    );
  }
}
