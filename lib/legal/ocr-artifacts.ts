import { createCanvas, loadImage } from "@napi-rs/canvas";

export type OcrArtifactCleanResult = {
  text: string;
  removedLines: number;
  removedTokens: number;
  flags: string[];
};

export type OcrImageVariants = {
  original: Buffer;
  enhanced: Buffer;
  topBand: Buffer;
};

function normalizeWhitespace(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isCertificationMetadata(line: string) {
  return (
    /^\s*SAO\s+Y\s*;/iu.test(line) &&
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/u.test(line) &&
    /\b\d{1,2}:\d{2}(?::\d{2})?\b/u.test(line)
  ) || /^(?:digitally signed by|signed by|ký bởi|người ký|thời gian ký)\s*:/iu.test(line);
}

function isScannerMetadata(line: string) {
  return /^(?:scanned by|scan by|camscanner|adobe scan|microsoft lens)\b/iu.test(line);
}

function isDecorativeOnly(line: string) {
  return /^[\s_─━—–\-=*·•.]{5,}$/u.test(line);
}

function isPageNumberAtEdge(line: string) {
  return /^(?:(?:trang|page)\s*)?\d{1,4}(?:\s*[/|]\s*\d{1,4})?\.?$/iu.test(line);
}

function stripVisualTokens(line: string) {
  let removed = 0;
  const cleaned = line
    .replace(/(?:^|[\s([{:;,-])LOGO(?=$|[\s)\]}:;,.!?-])/giu, (match) => {
      removed += 1;
      return match.startsWith(" ") ? " " : "";
    })
    .replace(/\bWATERMARK\b/giu, () => {
      removed += 1;
      return "";
    })
    .replace(/[ ]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
  return { cleaned, removed };
}

export function cleanVisualArtifacts(value: string): OcrArtifactCleanResult {
  const sourceLines = normalizeWhitespace(value).split("\n");
  const kept: string[] = [];
  const flags = new Set<string>();
  let removedLines = 0;
  let removedTokens = 0;

  sourceLines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    const nearEdge = index <= 2 || index >= sourceLines.length - 3;

    if (!line) {
      if (kept.length && kept[kept.length - 1] !== "") kept.push("");
      return;
    }
    if (isCertificationMetadata(line)) {
      removedLines += 1;
      flags.add("certification_metadata");
      return;
    }
    if (isScannerMetadata(line)) {
      removedLines += 1;
      flags.add("scanner_metadata");
      return;
    }
    if (isDecorativeOnly(line)) {
      removedLines += 1;
      flags.add("decorative_lines");
      return;
    }
    if (nearEdge && isPageNumberAtEdge(line)) {
      removedLines += 1;
      flags.add("page_numbers");
      return;
    }

    const tokenResult = stripVisualTokens(line);
    removedTokens += tokenResult.removed;
    if (tokenResult.removed) flags.add("logo_or_watermark");
    if (tokenResult.cleaned) kept.push(tokenResult.cleaned);
  });

  return {
    text: normalizeWhitespace(kept.join("\n")),
    removedLines,
    removedTokens,
    flags: [...flags],
  };
}

export function hasVisualArtifactHints(value: string) {
  const text = value || "";
  return (
    /\bLOGO\b|\bWATERMARK\b/iu.test(text) ||
    /\bSAO\s+Y\s*;/iu.test(text) ||
    /(?:�|□{2,}|■{2,}|\?{2,}|\[không đọc rõ\])/iu.test(text) ||
    text.split("\n").some((line) => isScannerMetadata(line.trim()))
  );
}

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export async function prepareOcrImageVariants(image: Buffer): Promise<OcrImageVariants> {
  try {
    const decoded = await loadImage(image);
    const width = decoded.width;
    const height = decoded.height;
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.drawImage(decoded, 0, 0, width, height);

    const pixels = context.getImageData(0, 0, width, height);
    const data = pixels.data;
    for (let offset = 0; offset < data.length; offset += 4) {
      const gray = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
      const contrasted = gray > 242 ? 255 : clampChannel((gray - 128) * 1.32 + 128);
      data[offset] = contrasted;
      data[offset + 1] = contrasted;
      data[offset + 2] = contrasted;
    }
    context.putImageData(pixels, 0, 0);
    const enhanced = canvas.toBuffer("image/png");

    const sourceBandHeight = Math.max(1, Math.min(height, Math.round(height * 0.42)));
    const scale = width < 2_200 ? Math.min(1.45, 2_200 / Math.max(1, width)) : 1;
    const bandCanvas = createCanvas(Math.round(width * scale), Math.round(sourceBandHeight * scale));
    const bandContext = bandCanvas.getContext("2d");
    bandContext.drawImage(canvas, 0, 0, width, sourceBandHeight, 0, 0, bandCanvas.width, bandCanvas.height);

    return {
      original: image,
      enhanced,
      topBand: bandCanvas.toBuffer("image/png"),
    };
  } catch {
    return { original: image, enhanced: image, topBand: image };
  }
}
