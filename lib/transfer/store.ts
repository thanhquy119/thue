import { del, get, list, put } from "../storage/r2-blob-compat.ts";
import {
  transferBasePath,
  transferMailboxId,
  transferMetaPath,
  transferTextPath,
  type TransferFileRecord,
} from "./core";
import { extractTransferredFile, TRANSFER_EXTRACTION_VERSION } from "./extraction";

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

async function refreshLegacyOfficeExtraction(mailboxId: string, meta: TransferFileRecord) {
  if (meta.extractionVersion === TRANSFER_EXTRACTION_VERSION) return meta;
  if (!meta.sourcePathname || !["doc", "docx", "html"].includes(meta.extractionMethod ?? "")) return meta;
  const source = await get(meta.sourcePathname, { access: "private", useCache: false });
  if (!source || source.statusCode !== 200) return meta;
  const buffer = await streamBuffer(source.stream);
  const extracted = await extractTransferredFile(buffer, meta.name, meta.contentType);
  if (extracted.text.length < 20) return meta;
  const textPathname = meta.textPathname || transferTextPath(mailboxId, meta.id);
  await writeJson(textPathname, { text: extracted.text });
  const refreshed: TransferFileRecord = {
    ...meta,
    updatedAt: new Date().toISOString(),
    status: extracted.partial ? "ocr_partial" : "ready",
    extractionMethod: extracted.method,
    extractionVersion: TRANSFER_EXTRACTION_VERSION,
    textPathname,
    characters: extracted.text.length,
    totalPages: extracted.totalPages,
    processedPages: extracted.processedPages,
    warnings: [...new Set([...meta.warnings, ...extracted.warnings])],
    error: null,
  };
  await writeJson(transferMetaPath(mailboxId, meta.id), refreshed);
  return refreshed;
}

async function readTransferPayload(meta: TransferFileRecord) {
  const text = meta.textPathname ? await readJson<{ text: string }>(meta.textPathname) : null;
  return { meta, text: text?.text ?? "" };
}

export async function processTransferredBlob(input: {
  mailboxId: string;
  fileId: string;
  name: string;
  size: number;
  contentType: string;
  sourcePathname: string;
  sourceBuffer?: Buffer;
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
    extractionVersion: TRANSFER_EXTRACTION_VERSION,
    textPathname: null,
    characters: 0,
    totalPages: 0,
    processedPages: 0,
    warnings: [],
    error: null,
  };
  await writeJson(transferMetaPath(input.mailboxId, input.fileId), base);

  try {
    let buffer = input.sourceBuffer;
    if (!buffer) {
      const source = await get(input.sourcePathname, { access: "private", useCache: false });
      if (!source || source.statusCode !== 200) throw new Error("Không đọc lại được file vừa tải lên.");
      buffer = await streamBuffer(source.stream);
    }
    const extracted = await extractTransferredFile(buffer, input.name, input.contentType);
    if (extracted.text.length < 20) throw new Error("File không chứa đủ nội dung chữ để đọc.");
    if (extracted.method === "pdf_ocr" && extracted.processedPages !== extracted.totalPages) {
      throw new Error(`PDF chưa được OCR đầy đủ (${extracted.processedPages}/${extracted.totalPages} trang).`);
    }
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
  return readTransferPayload(meta);
}

export async function refreshTransferredFileExtraction(key: string, fileId: string) {
  const mailboxId = transferMailboxId(key);
  const initialMeta = await readJson<TransferFileRecord>(transferMetaPath(mailboxId, fileId));
  if (!initialMeta) return null;
  const meta = await refreshLegacyOfficeExtraction(mailboxId, initialMeta);
  return readTransferPayload(meta);
}

export async function reprocessTransferredPdf(key: string, fileId: string) {
  const mailboxId = transferMailboxId(key);
  const pathname = transferMetaPath(mailboxId, fileId);
  const initial = await readJson<TransferFileRecord>(pathname);
  if (!initial) return null;
  const isPdf = initial.contentType.includes("pdf") || initial.name.toLocaleLowerCase("en").endsWith(".pdf");
  const needsFullOcr = isPdf && (
    initial.status === "ocr_partial" ||
    (initial.extractionMethod === "pdf_ocr" && initial.processedPages < initial.totalPages)
  );
  if (!needsFullOcr || initial.status === "processing") return readTransferPayload(initial);

  const processing: TransferFileRecord = {
    ...initial,
    updatedAt: new Date().toISOString(),
    status: "processing",
    textPathname: null,
    warnings: [],
    error: null,
  };
  await writeJson(pathname, processing);

  try {
    const source = await get(initial.sourcePathname, { access: "private", useCache: false });
    if (!source || source.statusCode !== 200) throw new Error("Không đọc lại được file PDF gốc.");
    const buffer = await streamBuffer(source.stream);
    const extracted = await extractTransferredFile(buffer, initial.name, initial.contentType);
    if (extracted.method !== "pdf_ocr" || extracted.processedPages !== extracted.totalPages || extracted.partial) {
      throw new Error(`PDF chưa được OCR đầy đủ (${extracted.processedPages}/${extracted.totalPages} trang).`);
    }
    if (extracted.text.length < 20) throw new Error("PDF không chứa đủ nội dung chữ để đọc.");
    const textPathname = transferTextPath(mailboxId, initial.id);
    await writeJson(textPathname, { text: extracted.text });
    const completed: TransferFileRecord = {
      ...processing,
      updatedAt: new Date().toISOString(),
      status: "ready",
      extractionMethod: extracted.method,
      extractionVersion: TRANSFER_EXTRACTION_VERSION,
      textPathname,
      characters: extracted.text.length,
      totalPages: extracted.totalPages,
      processedPages: extracted.processedPages,
      warnings: [],
      error: null,
    };
    await writeJson(pathname, completed);
    return readTransferPayload(completed);
  } catch (error) {
    const failed: TransferFileRecord = {
      ...processing,
      updatedAt: new Date().toISOString(),
      status: "failed",
      error: error instanceof Error ? error.message : "Không thể OCR đầy đủ PDF.",
    };
    await writeJson(pathname, failed);
    return readTransferPayload(failed);
  }
}

export async function deleteTransferredFile(key: string, fileId: string) {
  const mailboxId = transferMailboxId(key);
  const prefix = `${transferBasePath(mailboxId, fileId)}/`;
  const result = await list({ prefix, limit: 1000 });
  if (result.blobs.length) await del(result.blobs.map((blob) => blob.url));
  return { deleted: result.blobs.length };
}
