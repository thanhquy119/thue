import {hasGeminiConfig} from "@/lib/legal/gemini";
import {azureTtsConfigured} from "./azure-tts";
import {videoBlobConfigured} from "./blob-assets";
import {remotionVercelConfigured} from "./remotion-renderer";
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
  const blob = videoBlobConfigured();
  const sandbox = remotionVercelConfigured();
  const missing = [
    !enabled ? "VIDEO_EXPERIMENT_ENABLED" : "",
    !storage ? "R2 hoặc Vercel Blob cho trạng thái job" : "",
    !gemini ? "GEMINI_API_KEY" : "",
    !azureTts ? "AZURE_SPEECH_KEY và AZURE_SPEECH_REGION" : "",
    !blob ? "BLOB_READ_WRITE_TOKEN" : "",
    !sandbox ? "Vercel Sandbox" : "",
  ].filter(Boolean);
  return {
    enabled,
    storage,
    gemini,
    azureTts,
    blob,
    sandbox,
    ready: !missing.length,
    missing,
    defaultVoice: "female",
    defaultLength: "standard",
  };
}
