export function parseOcrPageSelection(value: string, limit = 30) {
  const pages = new Set<number>();
  const parts = value.split(/[,;\s]+/u).map((part) => part.trim()).filter(Boolean);

  for (const part of parts) {
    const range = part.match(/^(\d{1,4})\s*[-–—]\s*(\d{1,4})$/u);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const lower = Math.min(start, end);
      const upper = Math.max(start, end);
      if (upper - lower > limit * 2) throw new Error("Khoảng trang quá rộng cho một lượt kiểm thử.");
      for (let page = lower; page <= upper && pages.size < limit; page += 1) {
        if (page >= 1) pages.add(page);
      }
      continue;
    }

    if (!/^\d{1,4}$/u.test(part)) throw new Error(`Không hiểu phạm vi trang “${part}”.`);
    const page = Number(part);
    if (page >= 1) pages.add(page);
    if (pages.size >= limit) break;
  }

  return [...pages].sort((left, right) => left - right);
}

export function formatOcrPageSelection(pages: number[]) {
  return [...new Set(pages)].sort((left, right) => left - right).join(", ");
}

export function chunkOcrPages(pages: number[], size = 3) {
  const chunks: number[][] = [];
  for (let index = 0; index < pages.length; index += Math.max(1, size)) {
    chunks.push(pages.slice(index, index + Math.max(1, size)));
  }
  return chunks;
}
