export const DEFAULT_LEGAL_VIDEO_GENERATION_RESUME_AT = "2026-08-31T17:00:00.000Z";

export function legalVideoGenerationResumeAt() {
  const configured = process.env.LEGAL_VIDEO_GENERATION_RESUME_AT?.trim();
  if (configured && Number.isFinite(Date.parse(configured))) {
    return new Date(configured).toISOString();
  }
  return DEFAULT_LEGAL_VIDEO_GENERATION_RESUME_AT;
}

export function legalVideoGenerationPaused(now: Date | number = new Date()) {
  const timestamp = now instanceof Date ? now.getTime() : now;
  return Number.isFinite(timestamp) && timestamp < Date.parse(legalVideoGenerationResumeAt());
}

export function legalVideoGenerationPauseMessage() {
  return "Tạm dừng tạo video mới để tiết kiệm hạn mức máy chủ. Hệ thống tự mở lại từ 01/09/2026.";
}
