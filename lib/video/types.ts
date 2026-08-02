import type {DocumentDetail} from "@/lib/legal/types";

export type LegalVideoLength = "brief" | "standard" | "detailed";
export type LegalVideoVoice = "female" | "male";

export type LegalVideoCategory =
  | "overview"
  | "scope"
  | "changes"
  | "procedure"
  | "obligation"
  | "deadline"
  | "numbers"
  | "effective"
  | "transition"
  | "forms"
  | "prepare";

export type LegalVideoSceneKind =
  | "intro"
  | "timeline"
  | "audience"
  | "change"
  | "process"
  | "numbers"
  | "prepare"
  | "summary";

export type LegalVideoEvidenceSection = {
  id: string;
  heading: string;
  text: string;
  provisionIds: string[];
  order: number;
};

export type LegalVideoEvidencePoint = {
  id: string;
  category: LegalVideoCategory;
  importance: 1 | 2 | 3 | 4 | 5;
  claim: string;
  sourceExcerpt: string;
  sectionId: string;
  provisionIds: string[];
};

export type LegalVideoAudioChunk = {
  id: string;
  text: string;
  url: string;
  durationSeconds: number;
  cacheKey: string;
};

export type LegalVideoScene = {
  id: string;
  kind: LegalVideoSceneKind;
  category: LegalVideoCategory;
  eyebrow: string;
  title: string;
  subtitle?: string;
  bullets: string[];
  narration: string;
  captionChunks: string[];
  evidencePointIds: string[];
  sourceExcerpt: string;
  audioChunks?: LegalVideoAudioChunk[];
};

export type LegalVideoCoverage = {
  detected: LegalVideoCategory[];
  covered: LegalVideoCategory[];
  missing: LegalVideoCategory[];
  evidencePointCount: number;
  selectedPointCount: number;
  coverageScore: number;
};

export type LegalVideoStoryboard = {
  version: 1;
  templateVersion: string;
  document: Pick<
    DocumentDetail,
    "id" | "number" | "title" | "type" | "issuer" | "issued_date" | "effective_date" | "status"
  >;
  length: LegalVideoLength;
  voice: LegalVideoVoice;
  fps: number;
  width: number;
  height: number;
  scenes: LegalVideoScene[];
  coverage: LegalVideoCoverage;
  createdAt: string;
};

export type LegalVideoJobStatus =
  | "queued"
  | "summarizing"
  | "synthesizing"
  | "rendering"
  | "ready"
  | "failed";

export type LegalVideoJob = {
  version: 1;
  jobId: string;
  workflowRunId: string | null;
  fingerprint: string;
  documentNumber: string;
  documentTitle: string;
  documentSnapshotPath: string;
  storyboardPath: string | null;
  status: LegalVideoJobStatus;
  progress: number;
  message: string;
  length: LegalVideoLength;
  voice: LegalVideoVoice;
  sceneCount: number;
  ttsChunkCount: number;
  completedTtsChunks: number;
  renderSandboxId: string | null;
  renderCommandId: string | null;
  videoPath: string | null;
  videoUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LegalVideoPublicJob = Omit<
  LegalVideoJob,
  | "fingerprint"
  | "documentSnapshotPath"
  | "storyboardPath"
  | "renderSandboxId"
  | "renderCommandId"
  | "videoPath"
> & {
  storyboardReady: boolean;
};

export type LegalVideoCapabilities = {
  enabled: boolean;
  storage: boolean;
  mediaStorage: "r2" | "none";
  r2: boolean;
  gemini: boolean;
  azureTts: boolean;
  // Trường tương thích tạm thời với response cũ; pipeline mới không dùng Vercel Blob.
  blob: boolean;
  sandbox: boolean;
  ready: boolean;
  missing: string[];
  defaultVoice: LegalVideoVoice;
  defaultLength: LegalVideoLength;
};

export type LegalVideoWorkflowInput = {
  jobId: string;
};

export type LegalVideoWorkflowResult = {
  jobId: string;
  status: "ready" | "failed";
  videoUrl: string | null;
  error: string | null;
};
