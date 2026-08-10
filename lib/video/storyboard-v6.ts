import {captionChunksBySentence} from "./caption-sentences";
import {normalizeSceneForVideo} from "./storyboard-normalize";
import {
  createLegalVideoStoryboard as createBaseStoryboard,
  summarizeVideoEvidenceSection,
} from "./storyboard";
import type {LegalVideoStoryboard} from "./types";

export {captionChunksBySentence, summarizeVideoEvidenceSection};

export function normalizeStoryboardCaptions(storyboard: LegalVideoStoryboard): LegalVideoStoryboard {
  return {
    ...storyboard,
    scenes: storyboard.scenes.map((rawScene) => {
      const scene = normalizeSceneForVideo(rawScene);
      return {
        ...scene,
        captionChunks: captionChunksBySentence(scene.narration),
      };
    }),
  };
}

export async function createLegalVideoStoryboard(
  input: Parameters<typeof createBaseStoryboard>[0],
): Promise<LegalVideoStoryboard> {
  return normalizeStoryboardCaptions(await createBaseStoryboard(input));
}
