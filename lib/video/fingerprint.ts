import {createHash} from "node:crypto";
import type {DocumentDetail} from "@/lib/legal/types";
import type {LegalVideoLength} from "./types";
import {VIDEO_TEMPLATE_VERSION} from "./chunking";

export function videoFingerprint(input: {
  document: DocumentDetail;
  length: LegalVideoLength;
  voice: string;
}) {
  return createHash("sha256")
    .update(VIDEO_TEMPLATE_VERSION)
    .update("\0")
    .update(input.document.number)
    .update("\0")
    .update(input.document.last_verified_at)
    .update("\0")
    .update(input.document.official_text)
    .update("\0")
    .update(input.length)
    .update("\0")
    .update(input.voice)
    .digest("hex");
}
