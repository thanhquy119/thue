export const LEGAL_CRON_PAUSED = true;

export function legalCronPaused() {
  return LEGAL_CRON_PAUSED;
}

export function legalCronPauseMessage() {
  return "Cron pháp luật đang tạm dừng để bảo toàn hạn mức Vercel Functions. Chỉ bật lại khi được yêu cầu.";
}
