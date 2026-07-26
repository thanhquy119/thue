import WordExtractor from "word-extractor";

function normalizeLegacyWordText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractLegacyWordText(buffer: Buffer) {
  const extractor = new WordExtractor();
  const document = await extractor.extract(buffer);
  const bodyText = normalizeLegacyWordText(document.getBody());
  const textboxText = normalizeLegacyWordText(
    document.getTextboxes({ includeHeadersAndFooters: false }),
  );
  return {
    text: normalizeLegacyWordText([bodyText, textboxText].filter(Boolean).join("\n\n")),
    bodyCharacters: bodyText.length,
    textboxCharacters: textboxText.length,
  };
}
