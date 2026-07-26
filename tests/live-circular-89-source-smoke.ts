import { loadRecentVerifiedDocument } from "../lib/legal/recent-verified-documents.ts";

const MARKER = "[live-questions]";
const enabled = process.env.RUN_LIVE_QUESTION_SMOKE === "true" ||
  (process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "").includes(MARKER);

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi");
}

function contexts(text: string, term: string, limit = 4) {
  const normalizedText = normalize(text);
  const normalizedTerm = normalize(term);
  const results: string[] = [];
  let start = 0;
  while (results.length < limit) {
    const index = normalizedText.indexOf(normalizedTerm, start);
    if (index < 0) break;
    results.push(text.slice(Math.max(0, index - 350), Math.min(text.length, index + normalizedTerm.length + 900)));
    start = index + normalizedTerm.length;
  }
  return results;
}

async function main() {
  if (!enabled) {
    console.log(`[live-circular-89-source] skipped; add ${MARKER} to the commit message.`);
    return;
  }
  const document = await loadRecentVerifiedDocument("89/2026/TT-BTC");
  const probes = [
    "[37]",
    "chỉ tiêu 37",
    "[38]",
    "chỉ tiêu 38",
    "điều chỉnh giảm số thuế",
    "điều chỉnh tăng số thuế",
    "trả chậm, trả góp",
    "thanh toán không dùng tiền mặt",
    "Mẫu số 01/GTGT",
    "01/GTGT",
    "hóa đơn điều chỉnh",
    "chuyển đổi phương pháp",
    "khai bổ sung hồ sơ khai thuế",
  ];
  console.log("[live-circular-89-source-summary]", JSON.stringify({
    characters: document.official_text.length,
    provisions: document.provisions.length,
    extractionMethod: document.extraction_method,
    probes: probes.map((term) => ({ term, contexts: contexts(document.official_text, term) })),
  }));
}

main().catch((error) => {
  console.error("[live-circular-89-source] failed", error);
  process.exitCode = 1;
});
