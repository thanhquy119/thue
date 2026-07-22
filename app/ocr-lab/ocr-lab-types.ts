export type PageResult = {
  page: number;
  similarity: number;
  chosenPass: "literal" | "structure" | "consensus" | "embedded";
  chosenScore: number;
  literalScore: number;
  structureScore: number;
  consensusScore: number | null;
  text: string;
  notices?: string[];
};

export type LabResult = {
  sourceUrl: string;
  model: string;
  totalPages: number;
  processedPages: number;
  truncated: boolean;
  embedded: { text: string; score: number; characters: number };
  ocr: { text: string; score: number; characters: number; pages: PageResult[] };
  recommendation: "prefer_ocr" | "keep_embedded" | "manual_review";
  warnings: string[];
};
