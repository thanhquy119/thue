import { del, get, list, put } from "@vercel/blob";
import {
  transferBasePath,
  transferMailboxId,
  transferMetaPath,
  transferTextPath,
  type TransferFileRecord,
} from "./core";
import { extractTransferredFile } from "./extraction";

async function streamBuffer(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) throw new Error("Không đọc được file đã tải lên.");
  return Buffer.from(await new Response(stream).arrayBuffer());
}

async function readJson<T>(pathname: string): Promise<T | null> {
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  const text = await new Response(result.stream).text();
  return text ? JSON.parse(text) as T : null;
}

async function writeJson(pathname: string, value: unknown) {
  return put(pathname, JSON.stringify(value), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 60,
  });
}

export async function processTransferredBlob(input: {
  mailboxId: string;
  fileId: string;
  name: string;
  size: number;
  contentType: string;
  sourcePathname: string;
}) {
  const now = new Date().toISOString();
  const base: TransferFileRecord = {
    id: input.fileId,
    name: input.name,
    size: input.size,
    contentType: input.contentType,
    sourcePathname: input.sourcePathname,
    createdAt: now,
    updatedAt: now,
    status: "processing",
    extractionMethod: null,
    textPathname: null,
    characters: 0,
    totalPages: 0,
    processedPages: 0,
    warnings: [],
    error: null,
  };
  await writeJson(transferMetaPath(input.mailboxId, input.fileId), base);

  try {
    const source = await get(input.sourcePathname, { access: "private", useCache: false });
    if (!source || source.statusCode !== 200) throw new Error("Không đọc lại được file vừa tải lên.");
    const buffer = await streamBuffer(source.stream);
    const extracted = await extractTransferredFile(buffer, input.name, input.contentType);
    if (extracted.text.length < 20) throw new Error("File không chứa đủ nội dung chữ để đọc.");
    const textPathname = transferTextPath(input.mailboxId, input.fileId);
    await writeJson(textPathname, { text: extracted.text });
    const completed: TransferFileRecord = {
      ...base,
      updatedAt: new Date().toISOString(),
      status: extracted.partial ? "ocr_partial" : "ready",
      extractionMethod: extracted.method,
      textPathname,
      characters: extracted.text.length,
      totalPages: extracted.totalPages,
      processedPages: extracted.processedPages,
      warnings: extracted.warnings,
    };
    await writeJson(transferMetaPath(input.mailboxId, input.fileId), completed);
    return completed;
  } catch (error) {
    const failed: TransferFileRecord = {
      ...base,
      updatedAt: new Date().toISOString(),
      status: "failed",
      error: error instanceof Error ? error.message : "Không thể xử lý file.",
    };
    await writeJson(transferMetaPath(input.mailboxId, input.fileId), failed);
    return failed;
  }
}

export async function listTransferredFiles(key: string) {
  const mailboxId = transferMailboxId(key);
  const prefix = `transfers/${mailboxId}/`;
  const records: TransferFileRecord[] = [];
  let cursor: string | undefined;
  do {
    const result = await list({ prefix, cursor, limit: 1000 });
    const metas = result.blobs.filter((blob) => blob.pathname.endsWith("/meta.json"));
    for (const meta of metas) {
      const record = await readJson<TransferFileRecord>(meta.pathname).catch(() => null);
      if (record) records.push(record);
    }
    cursor = result.cursor;
  } while (cursor);
  return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 100);
}

export async function readTransferredFile(key: string, fileId: string) {
  const mailboxId = transferMailboxId(key);
  const meta = await readJson<TransferFileRecord>(transferMetaPath(mailboxId, fileId));
  if (!meta) return null;
  const text = meta.textPathname ? await readJson<{ text: string }>(meta.textPathname) : null;
  return { meta, text: text?.text ?? "" };
}

export async function deleteTransferredFile(key: string, fileId: string) {
  const mailboxId = transferMailboxId(key);
  const prefix = `${transferBasePath(mailboxId, fileId)}/`;
  const result = await list({ prefix, limit: 1000 });
  if (result.blobs.length) await del(result.blobs.map((blob) => blob.url));
  return { deleted: result.blobs.length };
}
