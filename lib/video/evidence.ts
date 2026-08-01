import type { LegalVideoPlan } from "./storyboard.ts";

export type VideoEvidenceCheck = {
  ok: boolean;
  errors: string[];
};

function comparable(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("vi")
    .replace(/[…]+$/gu, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function numericClaims(value: string) {
  return value
    .normalize("NFKC")
    .match(/\d+(?:[.,:/-]\d+)*/gu) ?? [];
}

function isClosingScene(plan: LegalVideoPlan, sceneIndex: number) {
  const scene = plan.scenes[sceneIndex];
  return scene.id === "ket-thuc" || (
    sceneIndex === plan.scenes.length - 1 &&
    /trước\s+khi\s+áp\s+dụng|đối\s+chiếu\s+toàn\s+văn|cảnh\s+báo/iu.test(`${scene.heading} ${scene.narration}`)
  );
}

/**
 * Kiểm tra tối thiểu trước khi chấp nhận storyboard do LLM tạo.
 * - Mỗi cảnh nội dung phải giữ một trích đoạn có thể tìm lại trong nguồn.
 * - Mọi chữ số xuất hiện ở tiêu đề, bullet hoặc lời đọc phải tồn tại trong nguồn.
 *
 * Đây không thay thế review pháp lý, nhưng chặn được hai lỗi nguy hiểm nhất:
 * trích dẫn không tồn tại và tự thêm ngày, tỷ lệ, mức tiền hoặc số hiệu.
 */
export function verifyVideoPlanAgainstSource(plan: LegalVideoPlan, source: string): VideoEvidenceCheck {
  const normalizedSource = comparable(source);
  const sourceNumbers = new Set(numericClaims(source));
  const errors: string[] = [];

  plan.scenes.forEach((scene, sceneIndex) => {
    const label = `Cảnh ${sceneIndex + 1} (${scene.id})`;
    if (!isClosingScene(plan, sceneIndex)) {
      const excerpt = comparable(scene.sourceExcerpt);
      if (excerpt.length < 12) {
        errors.push(`${label}: dẫn chứng quá ngắn.`);
      } else if (!normalizedSource.includes(excerpt)) {
        errors.push(`${label}: sourceExcerpt không tìm thấy trong văn bản nguồn.`);
      }
    }

    const visibleClaims = [scene.heading, scene.narration, ...scene.bullets].join(" ");
    const unsupported = [...new Set(numericClaims(visibleClaims))]
      .filter((claim) => !sourceNumbers.has(claim));
    if (unsupported.length) {
      errors.push(`${label}: có số liệu không xuất hiện trong nguồn (${unsupported.join(", ")}).`);
    }
  });

  return { ok: errors.length === 0, errors };
}
