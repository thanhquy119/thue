import {hasGeminiConfig} from "@/lib/legal/gemini";
import {azureTtsConfigured} from "./azure-tts";
import {videoAwsConfigured} from "./aws-assets";
import {remotionLambdaConfigured} from "./remotion-renderer";
import {legalVideoStoreConfigured} from "./store";
import type {LegalVideoCapabilities} from "./types";

export function legalVideoExperimentEnabled() {
  return process.env.VIDEO_EXPERIMENT_ENABLED === "true" || process.env.VERCEL_ENV !== "production";
}

export function legalVideoCapabilities(): LegalVideoCapabilities {
  const enabled = legalVideoExperimentEnabled();
  const storage = legalVideoStoreConfigured();
  const gemini = hasGeminiConfig();
  const azureTts = azureTtsConfigured();
  const aws = videoAwsConfigured();
  const remotion = remotionLambdaConfigured();
  const missing = [
    !enabled ? "VIDEO_EXPERIMENT_ENABLED" : "",
    !storage ? "R2 hoặc Vercel Blob" : "",
    !gemini ? "GEMINI_API_KEY" : "",
    !azureTts ? "AZURE_SPEECH_KEY và AZURE_SPEECH_REGION" : "",
    !aws ? "AWS và VIDEO_ASSET_BUCKET" : "",
    !remotion ? "REMOTION_FUNCTION_NAME và REMOTION_SERVE_URL" : "",
  ].filter(Boolean);
  return {
    enabled,
    storage,
    gemini,
    azureTts,
    aws,
    remotion,
    ready: !missing.length,
    missing,
    defaultVoice: "female",
    defaultLength: "standard",
  };
}
