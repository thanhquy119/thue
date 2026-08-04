import {hasGeminiConfig} from "@/lib/legal/gemini";
import {azureTtsConfigured} from "./azure-tts";
import {
  legalVideoGenerationPaused,
  legalVideoGenerationPauseMessage,
  legalVideoGenerationResumeAt,
} from "./generation-pause";
import {videoMediaConfigured} from "./r2-assets";
import {remotionVercelConfigured} from "./remotion-renderer";
import {legalVideoR2Configured} from "./r2-media";
import {legalVideoStoreConfigured} from "./store";
import type {LegalVideoCapabilities} from "./types";

export function legalVideoExperimentEnabled() {
  return process.env.VIDEO_EXPERIMENT_ENABLED === "true" || process.env.VERCEL_ENV !== "production";
}

export function legalVideoCapabilities(): LegalVideoCapabilities {
  const enabled = legalVideoExperimentEnabled();
  const r2 = legalVideoR2Configured();
  const storage = r2 && legalVideoStoreConfigured();
  const media = videoMediaConfigured();
  const gemini = hasGeminiConfig();
  const azureTts = azureTtsConfigured();
  const sandbox = remotionVercelConfigured();
  const generationPaused = legalVideoGenerationPaused();
  const missing = [
    !enabled ? "VIDEO_EXPERIMENT_ENABLED" : "",
    !storage ? "R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID và R2_SECRET_ACCESS_KEY" : "",
    !gemini ? "GEMINI_API_KEY" : "",
    !azureTts ? "AZURE_SPEECH_KEY và AZURE_SPEECH_REGION" : "",
    !media ? "R2 cho audio và video" : "",
    !sandbox ? "Vercel Sandbox và snapshot Remotion trên R2" : "",
  ].filter(Boolean);
  return {
    enabled,
    storage,
    mediaStorage: r2 ? "r2" : "none",
    r2,
    gemini,
    azureTts,
    blob: false,
    sandbox,
    ready: !missing.length,
    missing,
    generationPaused,
    generationResumeAt: legalVideoGenerationResumeAt(),
    generationPauseMessage: legalVideoGenerationPauseMessage(),
    defaultVoice: "female",
    defaultLength: "standard",
  };
}
