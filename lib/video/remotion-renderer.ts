import {getRenderProgress, renderMediaOnLambda} from "@remotion/lambda/client";
import type {LegalVideoStoryboard} from "./types";

function region() {
  return process.env.VIDEO_AWS_REGION?.trim() || process.env.AWS_REGION?.trim() || "";
}

function functionName() {
  return process.env.REMOTION_FUNCTION_NAME?.trim() || "";
}

function serveUrl() {
  return process.env.REMOTION_SERVE_URL?.trim() || "";
}

function compositionId() {
  return process.env.REMOTION_COMPOSITION_ID?.trim() || "LegalVideo";
}

export function remotionLambdaConfigured() {
  return Boolean(region() && functionName() && serveUrl());
}

function renderLicense() {
  return process.env.REMOTION_LICENSE_KEY?.trim() || undefined;
}

export async function startLegalVideoRender(input: {
  jobId: string;
  storyboard: LegalVideoStoryboard;
}) {
  if (!remotionLambdaConfigured()) throw new Error("Remotion Lambda chưa được cấu hình.");
  const slug = input.storyboard.document.number
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/đ/giu, "d")
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLocaleLowerCase("vi");
  return renderMediaOnLambda({
    region: region() as never,
    functionName: functionName(),
    serveUrl: serveUrl(),
    composition: compositionId(),
    codec: "h264",
    audioCodec: "aac",
    inputProps: {storyboard: input.storyboard},
    privacy: "public",
    concurrency: 8,
    maxRetries: 2,
    timeoutInMilliseconds: 120_000,
    crf: 22,
    outName: `${slug || input.jobId}.mp4`,
    overwrite: true,
    deleteAfter: "7-days",
    downloadBehavior: {type: "play-in-browser"},
    licenseKey: renderLicense(),
    isProduction: process.env.VERCEL_ENV === "production",
  });
}

export async function legalVideoRenderProgress(input: {
  renderId: string;
  bucketName: string;
}) {
  if (!remotionLambdaConfigured()) throw new Error("Remotion Lambda chưa được cấu hình.");
  try {
    return await getRenderProgress({
      region: region() as never,
      functionName: functionName(),
      renderId: input.renderId,
      bucketName: input.bucketName,
      skipLambdaInvocation: true,
    });
  } catch {
    return getRenderProgress({
      region: region() as never,
      functionName: functionName(),
      renderId: input.renderId,
      bucketName: input.bucketName,
    });
  }
}
