export const OCR_MODEL_IDS = ["gemini-3.5-flash-lite", "gemini-3.6-flash"] as const;

export type OcrModelId = (typeof OCR_MODEL_IDS)[number];
export type OcrModelChoice = "auto" | OcrModelId;

export const OCR_MODEL_OPTIONS: Array<{
  value: OcrModelChoice;
  label: string;
  description: string;
}> = [
  {
    value: "auto",
    label: "Tự động · 3.5 Flash-Lite",
    description: "Ưu tiên model nhanh và hạn mức cao; tự chuyển sang model dự phòng khi API lỗi.",
  },
  {
    value: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    description: "Phù hợp OCR nhiều trang, chi phí thấp và thông lượng cao.",
  },
  {
    value: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    description: "Dùng để đối chiếu các trang khó; mạnh hơn nhưng hạn mức tài khoản thường thấp hơn.",
  },
];

export function normalizeOcrModelChoice(value: unknown): OcrModelChoice {
  return value === "gemini-3.5-flash-lite" || value === "gemini-3.6-flash" ? value : "auto";
}

function supportedConfiguredModel(value: string | undefined) {
  const model = value?.trim() ?? "";
  return /^gemini-(?:3\.6-flash|3\.5-flash-lite|3\.1-flash-lite|3-flash-preview)$/u.test(model)
    ? model
    : "";
}

export function ocrModelCandidates(choice: OcrModelChoice, configuredModel?: string) {
  const configured = supportedConfiguredModel(configuredModel);
  const candidates = choice === "gemini-3.6-flash"
    ? ["gemini-3.6-flash", "gemini-3.5-flash-lite", configured, "gemini-3.1-flash-lite"]
    : choice === "gemini-3.5-flash-lite"
      ? ["gemini-3.5-flash-lite", configured, "gemini-3.1-flash-lite"]
      : ["gemini-3.5-flash-lite", configured, "gemini-3.1-flash-lite"];
  return [...new Set(candidates.filter(Boolean))];
}

export function ocrModelResultLabel(choice: OcrModelChoice) {
  if (choice === "gemini-3.6-flash") return "gemini-3.6-flash";
  if (choice === "gemini-3.5-flash-lite") return "gemini-3.5-flash-lite";
  return "auto · gemini-3.5-flash-lite";
}
