/**
 * 在原句里找到每个词的位置、把原句切成标出的片段：影子跟读逐词标出读到哪里、哪些词没说出来，精听挖空。
 */

/** 每个词在原句里的位置 [起, 止)（按顺序往后找，先区分大小写再不区分）；找不到为 null */
export function locateWords(text: string, words: string[]): ({ start: number; end: number } | null)[] {
  const lower = text.toLowerCase();
  let from = 0;
  return words.map((w) => {
    let at = text.indexOf(w, from);
    if (at < 0) at = lower.indexOf(w.toLowerCase(), from);
    if (at < 0) return null;
    from = at + w.length;
    return { start: at, end: at + w.length };
  });
}

/** 原句切成片段：标出的词（`marks` 与 `ranges` 一一对应）单独成段，其余原样 */
export function markedPieces<T>(text: string, ranges: ({ start: number; end: number } | null)[], marks: T[]): { text: string; mark: T | null }[] {
  const pieces: { text: string; mark: T | null }[] = [];
  let at = 0;
  ranges.forEach((r, k) => {
    if (!r || r.start < at) return;
    if (r.start > at) pieces.push({ text: text.slice(at, r.start), mark: null });
    pieces.push({ text: text.slice(r.start, r.end), mark: marks[k] });
    at = r.end;
  });
  if (at < text.length) pieces.push({ text: text.slice(at), mark: null });
  return pieces;
}
