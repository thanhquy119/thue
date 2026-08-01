import {randomUUID} from "node:crypto";
import {start} from "workflow/api";
import type {DocumentDetail} from "@/lib/legal/types";
import {classifyStrictTaxDocumentForNotification} from "@/lib/notifications/tax-notification-policy";
import {legalVideoCapabilities} from "./capabilities";
import {videoFingerprint} from "./fingerprint";
import {
  documentSnapshotPath,
  findReusableLegalVideoJob,
  writeLegalVideoDocument,
  writeLegalVideoJob,
} from "./store";
import type {LegalVideoJob} from "./types";
import {legalVideoGenerationWorkflow} from "@/workflows/legal-video-generation";

export const DEFAULT_LEGAL_VIDEO_AUTOMATION_START_AT = "2026-08-01T16:21:00.000Z";

export type AutomaticLegalVideoRevision = {
  revisionId: string;
  publishedAt: string;
  validation: {accepted: boolean};
  document: DocumentDetail;
};

export type AutomaticLegalVideoDecision = {
  shouldStart: boolean;
  reason:
    | "eligible"
    | "disabled"
    | "before_rollout"
    | "old_issued_document"
    | "not_accepted"
    | "not_tax_document"
    | "insufficient_text"
    | "pipeline_not_ready";
  startAt: string;
};

function automationEnabled() {
  return process.env.LEGAL_VIDEO_AUTO_CREATE?.trim().toLocaleLowerCase("en") !== "false";
}

export function legalVideoAutomationStartAt() {
  const configured = process.env.LEGAL_VIDEO_AUTOMATION_START_AT?.trim();
  if (configured && Number.isFinite(Date.parse(configured))) return new Date(configured).toISOString();
  return DEFAULT_LEGAL_VIDEO_AUTOMATION_START_AT;
}

export function automaticLegalVideoDecision(
  revision: AutomaticLegalVideoRevision,
): AutomaticLegalVideoDecision {
  const startAt = legalVideoAutomationStartAt();
  if (!automationEnabled()) return {shouldStart: false, reason: "disabled", startAt};
  if (!revision.validation.accepted) return {shouldStart: false, reason: "not_accepted", startAt};
  if (!Number.isFinite(Date.parse(revision.publishedAt)) || Date.parse(revision.publishedAt) < Date.parse(startAt)) {
    return {shouldStart: false, reason: "before_rollout", startAt};
  }

  const issuedDate = revision.document.issued_date;
  const rolloutDate = startAt.slice(0, 10);
  if (!issuedDate || issuedDate < rolloutDate) {
    return {shouldStart: false, reason: "old_issued_document", startAt};
  }

  const classification = classifyStrictTaxDocumentForNotification({
    title: revision.document.title,
    officialText: revision.document.official_text,
    documentType: revision.document.type,
    issuer: revision.document.issuer,
  });
  if (!classification.eligible) return {shouldStart: false, reason: "not_tax_document", startAt};
  if (revision.document.official_text.trim().length < 1_500) {
    return {shouldStart: false, reason: "insufficient_text", startAt};
  }
  if (!legalVideoCapabilities().ready) {
    return {shouldStart: false, reason: "pipeline_not_ready", startAt};
  }
  return {shouldStart: true, reason: "eligible", startAt};
}

export async function startAutomaticLegalVideo(
  revision: AutomaticLegalVideoRevision,
) {
  const decision = automaticLegalVideoDecision(revision);
  if (!decision.shouldStart) {
    return {started: false as const, reused: false as const, decision, job: null};
  }

  const document = revision.document;
  const length = "detailed" as const;
  const voice = "female" as const;
  const fingerprint = videoFingerprint({document, length, voice});
  const reusable = await findReusableLegalVideoJob(fingerprint);
  if (reusable) {
    // Ghi lại để bổ sung/chữa chỉ mục theo số hiệu sau khi nâng cấp store.
    const indexed = await writeLegalVideoJob(reusable);
    return {started: false as const, reused: true as const, decision, job: indexed};
  }

  const jobId = randomUUID();
  const createdAt = new Date().toISOString();
  const snapshotPath = documentSnapshotPath(fingerprint);
  const job: LegalVideoJob = {
    version: 1,
    jobId,
    workflowRunId: null,
    fingerprint,
    documentNumber: document.number,
    documentTitle: document.title,
    documentSnapshotPath: snapshotPath,
    storyboardPath: null,
    status: "queued",
    progress: 1,
    message: "Đã xếp hàng tạo video chi tiết cho văn bản thuế mới.",
    length,
    voice,
    sceneCount: 0,
    ttsChunkCount: 0,
    completedTtsChunks: 0,
    renderSandboxId: null,
    renderCommandId: null,
    videoPath: null,
    videoUrl: null,
    error: null,
    createdAt,
    updatedAt: createdAt,
  };

  await writeLegalVideoDocument(snapshotPath, document);
  await writeLegalVideoJob(job);
  const run = await start(legalVideoGenerationWorkflow, [{jobId}]);
  const updated = await writeLegalVideoJob({...job, workflowRunId: run.runId});
  return {started: true as const, reused: false as const, decision, job: updated};
}
