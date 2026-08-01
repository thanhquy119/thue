import {get} from "@vercel/blob";
import {Sandbox} from "@vercel/sandbox";
import {getRenderProgress, renderMediaOnVercel} from "@remotion/vercel";
import type {LegalVideoStoryboard} from "./types";

function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() || "";
}

function compositionId() {
  return process.env.REMOTION_COMPOSITION_ID?.trim() || "LegalVideo";
}

export function videoSnapshotBlobKey() {
  return `legal-video/snapshots/${process.env.VERCEL_DEPLOYMENT_ID?.trim() || "local"}.json`;
}

export function remotionVercelConfigured() {
  return Boolean(blobToken());
}

async function snapshotId() {
  const configured = process.env.VIDEO_RENDER_SNAPSHOT_ID?.trim();
  if (configured) return configured;
  const snapshot = await get(videoSnapshotBlobKey(), {
    access: "public",
    token: blobToken(),
  });
  if (!snapshot?.stream) {
    throw new Error("Chưa có snapshot Remotion cho deployment hiện tại. Hãy redeploy sau khi kết nối Vercel Blob.");
  }
  const payload = await new Response(snapshot.stream).json() as {snapshotId?: unknown};
  if (typeof payload.snapshotId !== "string" || !payload.snapshotId.trim()) {
    throw new Error("Snapshot Remotion không hợp lệ.");
  }
  return payload.snapshotId;
}

async function restoreVideoSandbox() {
  if (!remotionVercelConfigured()) throw new Error("Vercel Blob chưa được cấu hình cho Remotion Sandbox.");
  return Sandbox.create({
    source: {type: "snapshot", snapshotId: await snapshotId()},
    timeout: 5 * 60 * 1000,
  });
}

function safeSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/đ/giu, "d")
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLocaleLowerCase("vi");
}

export async function startLegalVideoRender(input: {
  jobId: string;
  storyboard: LegalVideoStoryboard;
}) {
  const sandbox = await restoreVideoSandbox();
  const slug = safeSlug(input.storyboard.document.number) || input.jobId;
  try {
    const render = await renderMediaOnVercel({
      sandbox,
      compositionId: compositionId(),
      inputProps: {storyboard: input.storyboard},
      codec: "h264",
      crf: 22,
      outputFile: `/tmp/${slug}.mp4`,
      detached: true,
      detachedSandboxTimeoutInMilliseconds: 40 * 60 * 1000,
      vercelBlob: {
        blobToken: blobToken(),
        access: "public",
        blobPath: `legal-video/renders/${input.jobId}/${slug}.mp4`,
      },
    });
    return {
      sandboxId: render.sandboxId,
      commandId: render.cmdId,
      outputFile: render.outputFile,
    };
  } catch (error) {
    await sandbox.stop().catch(() => undefined);
    throw error;
  }
}

export async function legalVideoRenderProgress(input: {
  sandboxId: string;
  commandId: string;
}) {
  if (!remotionVercelConfigured()) throw new Error("Vercel Blob chưa được cấu hình cho Remotion Sandbox.");
  const progress = await getRenderProgress({
    sandboxId: input.sandboxId,
    cmdId: input.commandId,
  });
  if (progress.stage === "done" || progress.stage === "error" || progress.stage === "expired") {
    await Sandbox.get({sandboxId: input.sandboxId})
      .then((sandbox) => sandbox.stop())
      .catch(() => undefined);
  }
  return progress;
}
