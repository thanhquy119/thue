export type OcrSpeechUnitData = {
  id: string;
  page: number;
  texts: string[];
};

export type OcrSpeechQueueItem = {
  unitIndex: number;
  unitId: string;
  page: number;
  chunkIndex: number;
  text: string;
};

export function buildOcrSpeechQueue(units: OcrSpeechUnitData[], startUnitIndex = 0): OcrSpeechQueueItem[] {
  if (!units.length) return [];
  const safeStart = Math.max(0, Math.min(units.length - 1, Math.floor(startUnitIndex)));
  return units.slice(safeStart).flatMap((unit, relativeIndex) => unit.texts.map((text, chunkIndex) => ({
    unitIndex: safeStart + relativeIndex,
    unitId: unit.id,
    page: unit.page,
    chunkIndex,
    text,
  })));
}

export function findOcrSpeechUnitIndex(units: OcrSpeechUnitData[], id: string) {
  return units.findIndex((unit) => unit.id === id);
}
