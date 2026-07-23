import { createHash } from "node:crypto";
import { runOcrBatch } from "@/lib/legal/ocr-batch-runner";
import {
  extractDurableLegalSource,
  sourceFileExtension,
  type DurableExtractedSource,
} from "@/lib/legal/durable-extraction";
import {
  durableStoreConfigured,
  publishDurableRevision,
  writeDurableIngestionState,
  writeDurableOcrPage,
  writeDurableSource,
  type DurablePublishedRevision,
} from "@/lib/legal/durable-document-store";
import {
  pageBatches,
  validateDurableLegalText,
  type DurableIngestionState,
  type DurableLegalSource,
  type DurableOcrPage,
} from "@/lib/legal/durable-ingestion-types";
import {
  cleanOcrTextForQuality,
  removeRepeatedPageEdgesForQuality,
  scoreLegalOcrTextForQuality,
} from "@/lib/legal/ocr-quality";
import { parseLegalHierarchy, slugifyDocument } from "@/lib/legal/ingestion";
import type { DocumentDetail } from "@/lib/legal/types";

export type LegalDocumentIngestionInput = {
  jobId: string;
  source: DurableLegalSource;
  persist?: boolean;
};

export type LegalDocumentIngestionResult = {
  jobId: string;
  number: string;
  status: "ready" | "needs_review" | "failed";
  extractionMethod: string | null;
  processedPages: number;
  totalPages: number;
  warnings: string[];
  revision: DurablePublishedRevision | null;
  error: string | null;
};

type ExtractedWorkflowSource = Omit<DurableExtractedSource, "sourceBuffer"> & {
  sourceBlobUrl: string | null;
};

function now() {
  return new Date().toISOString();
}

function state(
  input: LegalDocumentIngestionInput,
  patch: Partial<DurableIngestionState>,
): DurableIngestionState {
  return {
    number: input.source.number,
    status: "processing",
    stage: "queued",
    runId: input.jobId,
    sourceUrl: input.source.sourceUrl,
    extractionMethod: null,
    processedPages: 0,
    totalPages: 0,
    qualityScore: null,
    warnings: [],
    error: null,
    updatedAt: now(),
    ...patch,
  };
}

export async function legalDocumentIngestionWorkflow(
  input: LegalDocumentIngestionInput,
): Promise<LegalDocumentIngestionResult> {
  "use workflow";

  const persist = input.persist !== false;
  if (persist) await writeStateStep(state(input, { stage: "downloading" }));

  try {
    const extracted = await extractSourceStep(input.source, persist);
    if (persist) {
      await writeStateStep(state(input, {
        stage: extracted.requiresOcr ? "ocr_processing" : "validating",
        extractionMethod: extracted.extractionMethod,
        totalPages: extracted.totalPages,
        qualityScore: extracted.qualityScore,
      }));
    }

    let text = extracted.officialText;
    let qualityScore = extracted.qualityScore;
    let extractionMethod: string = extracted.extractionMethod;
    let pages: DurableOcrPage[] = [];

    if (extracted.requiresOcr) {
      if (extracted.totalPages <= 0) throw new Error("PDF scan không xác định được tổng số trang.");
      for (const batch of pageBatches(extracted.totalPages, 3)) {
        const completed = await ocrPagesStep(
          input.source.number,
          input.jobId,
          extracted.sourceUrl,
          batch,
          persist,
        );
        pages = [...pages, ...completed].sort((left, right) => left.page - right.page);
        if (persist) {
          await writeStateStep(state(input, {
            stage: "ocr_processing",
            extractionMethod: "ocr",
            processedPages: pages.length,
            totalPages: extracted.totalPages,
            qualityScore: pages.length
              ? pages.reduce((sum, page) => sum + page.score, 0) / pages.length
              : 0,
            warnings: pages.flatMap((page) => page.notices),
          }));
        }
      }
      const cleanedPages = removeRepeatedPageEdgesForQuality(pages.map((page) => page.text));
      pages = pages.map((page, index) => ({ ...page, text: cleanedPages[index] ?? page.text }));
      text = cleanOcrTextForQuality(cleanedPages.filter(Boolean).join("\n\n"));
      qualityScore = scoreLegalOcrTextForQuality(text);
      extractionMethod = "ocr";
    }

    if (persist) {
      await writeStateStep(state(input, {
        stage: "validating",
        extractionMethod,
        processedPages: pages.length,
        totalPages: extracted.requiresOcr ? extracted.totalPages : 0,
        qualityScore,
      }));
    }

    const revision = await validateAndBuildRevisionStep(
      input.source,
      extracted,
      text,
      extractionMethod,
      qualityScore,
      pages,
    );

    if (!revision.validation.accepted) {
      if (persist) {
        await writeStateStep(state(input, {
          status: "needs_review",
          stage: "completed",
          extractionMethod,
          processedPages: pages.length,
          totalPages: extracted.requiresOcr ? extracted.totalPages : 0,
          qualityScore,
          warnings: revision.validation.warnings,
        }));
      }
      return {
        jobId: input.jobId,
        number: input.source.number,
        status: "needs_review",
        extractionMethod,
        processedPages: pages.length,
        totalPages: extracted.totalPages,
        warnings: revision.validation.warnings,
        revision,
        error: null,
      };
    }

    if (persist) {
      await writeStateStep(state(input, {
        stage: "publishing",
        extractionMethod,
        processedPages: pages.length,
        totalPages: extracted.requiresOcr ? extracted.totalPages : 0,
        qualityScore,
      }));
      await publishRevisionStep(revision);
      await writeStateStep(state(input, {
        status: "ready",
        stage: "completed",
        extractionMethod,
        processedPages: pages.length,
        totalPages: extracted.requiresOcr ? extracted.totalPages : 0,
        qualityScore,
      }));
    }

    return {
      jobId: input.jobId,
      number: input.source.number,
      status: "ready",
      extractionMethod,
      processedPages: pages.length,
      totalPages: extracted.totalPages,
      warnings: [],
      revision,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nhập văn bản thất bại.";
    await reportFailureStep(input.source.number, input.jobId, message).catch(() => undefined);
    if (persist && durableStoreConfigured()) {
      await writeStateStep(state(input, {
        status: "failed",
        stage: "completed",
        error: message,
      })).catch(() => undefined);
    }
    return {
      jobId: input.jobId,
      number: input.source.number,
      status: "failed",
      extractionMethod: null,
      processedPages: 0,
      totalPages: 0,
      warnings: [],
      revision: null,
      error: message,
    };
  }
}

async function writeStateStep(value: DurableIngestionState) {
  "use step";
  await writeDurableIngestionState({ ...value, updatedAt: now() });
}

async function extractSourceStep(
  source: DurableLegalSource,
  persist: boolean,
): Promise<ExtractedWorkflowSource> {
  "use step";
  const extracted = await extractDurableLegalSource(source.sourceUrl);
  let sourceBlobUrl: string | null = null;
  if (persist) {
    const stored = await writeDurableSource(
      source.number,
      extracted.sha256,
      sourceFileExtension(extracted),
      extracted.sourceBuffer,
      extracted.mimeType,
    );
    sourceBlobUrl = stored.url;
  }
  console.info("[legal-ingestion-source]", JSON.stringify({
    number: source.number,
    sourceUrl: extracted.sourceUrl,
    mimeType: extracted.mimeType,
    fileName: extracted.fileName,
    bytes: extracted.sourceBuffer.byteLength,
    sha256: extracted.sha256,
    extractionMethod: extracted.extractionMethod,
    requiresOcr: extracted.requiresOcr,
    totalPages: extracted.totalPages,
    qualityScore: extracted.qualityScore,
    persist,
  }));
  const { sourceBuffer: _sourceBuffer, ...serializable } = extracted;
  return { ...serializable, sourceBlobUrl };
}

async function ocrPagesStep(
  number: string,
  jobId: string,
  sourceUrl: string,
  pages: number[],
  persist: boolean,
): Promise<DurableOcrPage[]> {
  "use step";
  const result = await runOcrBatch(sourceUrl, { pages });
  const completed = result.ocr.pages.map((page) => ({
    page: page.page,
    text: page.text,
    score: page.chosenScore,
    similarity: page.similarity,
    chosenPass: page.chosenPass,
    notices: page.notices ?? [],
  }));
  if (persist) {
    for (const page of completed) await writeDurableOcrPage(number, jobId, page);
  }
  console.info("[legal-ingestion-ocr-batch]", JSON.stringify({
    number,
    jobId,
    requestedPages: pages,
    processedPages: completed.map((page) => page.page),
    scores: completed.map((page) => ({
      page: page.page,
      score: page.score,
      similarity: page.similarity,
      chosenPass: page.chosenPass,
      notices: page.notices,
    })),
    persist,
  }));
  return completed;
}

async function validateAndBuildRevisionStep(
  source: DurableLegalSource,
  extracted: ExtractedWorkflowSource,
  text: string,
  extractionMethod: string,
  qualityScore: number,
  pages: DurableOcrPage[],
): Promise<DurablePublishedRevision> {
  "use step";
  const validation = validateDurableLegalText({
    expectedNumber: source.number,
    issuedDate: source.issuedDate,
    text,
    extractionMethod,
    qualityScore,
    totalPages: extractionMethod === "ocr" ? extracted.totalPages : 0,
    pages,
  });
  console.info("[legal-ingestion-validation]", JSON.stringify({
    number: source.number,
    accepted: validation.accepted,
    extractionMethod,
    qualityScore,
    sourceSha256: extracted.sha256,
    sourceUrl: extracted.sourceUrl,
    metrics: validation.metrics,
    warnings: validation.warnings,
  }));
  const provisions = parseLegalHierarchy(text).map((provision, index) => ({
    id: `${slugifyDocument(source.number)}-${index}`,
    type: provision.provisionType,
    identifier: provision.identifier,
    article: provision.article,
    heading: provision.heading,
    official_text: provision.officialText,
    order_index: provision.orderIndex,
  }));
  const document: DocumentDetail = {
    id: slugifyDocument(`${source.number}-${source.issuer || "van-ban"}`),
    number: source.number,
    title: source.title,
    type: source.type,
    issuer: source.issuer,
    issued_date: source.issuedDate,
    effective_date: source.effectiveDate,
    status: source.effectiveDate && source.effectiveDate > new Date().toISOString().slice(0, 10)
      ? "upcoming"
      : source.effectiveDate
        ? "effective"
        : "unknown",
    source_url: source.officialPageUrl,
    source_label: source.sourceLabel,
    last_verified_at: now(),
    extraction_method: extractionMethod,
    quality_score: qualityScore,
    verification_notes: validation.accepted
      ? `Nguồn được nhập nền theo thứ tự DOCX → DOC → PDF text → HTML → OCR theo nhóm trang; SHA-256 ${extracted.sha256}.`
      : `Chưa tự động công bố vì còn ${validation.warnings.length} cảnh báo kiểm tra.`,
    official_text: text,
    provisions,
  };
  const revisionId = createHash("sha256")
    .update(`${extracted.sha256}\n${text}`)
    .digest("hex");
  return {
    revisionId,
    sourceSha256: extracted.sha256,
    sourceBlobUrl: extracted.sourceBlobUrl,
    document,
    validation,
    publishedAt: now(),
  };
}

async function publishRevisionStep(revision: DurablePublishedRevision) {
  "use step";
  await publishDurableRevision(revision);
  console.info("[legal-ingestion-published]", JSON.stringify({
    number: revision.document.number,
    revisionId: revision.revisionId,
    sourceSha256: revision.sourceSha256,
    extractionMethod: revision.document.extraction_method,
    qualityScore: revision.document.quality_score,
    publishedAt: revision.publishedAt,
  }));
}

async function reportFailureStep(number: string, jobId: string, message: string) {
  "use step";
  console.error("[legal-ingestion-failed]", JSON.stringify({ number, jobId, message }));
}
