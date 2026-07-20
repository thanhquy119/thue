export type EffectiveStatus =
  | "upcoming"
  | "effective"
  | "partially_effective"
  | "expired"
  | "repealed"
  | "unknown";

export type SearchHint = {
  normalized: string;
  number: string | null;
  year: string | null;
  type: string | null;
  asksQuestion: boolean;
};

export type OnlineLegalSource = {
  id: string;
  title: string;
  url: string;
  snippet: string;
  score: number;
  source_label: string;
  previewable?: boolean;
};

export type ProvisionDetail = {
  id: string;
  type: "preamble" | "chapter" | "section" | "article" | "other";
  identifier: string | null;
  article: string | null;
  heading: string | null;
  official_text: string;
  order_index: number;
};

export type DocumentDetail = {
  id: string;
  number: string;
  title: string;
  type: string;
  issuer: string;
  issued_date: string | null;
  effective_date: string | null;
  status: EffectiveStatus;
  source_url: string;
  source_label: string;
  last_verified_at: string;
  extraction_method: string;
  quality_score: number;
  verification_notes: string | null;
  official_text: string;
  provisions: ProvisionDetail[];
};

export type TaxSearchResponse = {
  query_normalized: string;
  query_kind: "document" | "question";
  direct_answer: string;
  document: DocumentDetail | null;
  warnings: string[];
  confidence: number;
  retrieved_at: string;
};
