import {captionChunksBySentence} from "./caption-sentences";
import {
  createLegalVideoStoryboard as createBaseStoryboard,
  summarizeVideoEvidenceSection,
} from "./storyboard";
import type {LegalVideoStoryboard} from "./types";

export {captionChunksBySentence, summarizeVideoEvidenceSection};

export function normalizeStoryboardCaptions(storyboard: LegalVideoStoryboard): LegalVideoStoryboard {
  return {
    ...storyboard,
    scenes: storyboard.scenes.map((scene) => ({
      ...scene,
      captionChunks: captionChunksBySentence(scene.narration),
    })),
  };
}

export async function createLegalVideoStoryboard(
  input: Parameters<typeof createBaseStoryboard>[0],
): Promise<LegalVideoStoryboard> {
  return normalizeStoryboardCaptions(await createBaseStoryboard(input));
}
