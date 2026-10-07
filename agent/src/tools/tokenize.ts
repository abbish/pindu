// 确定性分词与词频（提词任务的“事实”部分由代码完成，模型只做筛选与标注，见 DECISIONS D05）

/** 规则：小写；与数字粘连的片段（12th、9:00）整体丢弃；仅字母；长度 2–20 */
export function tokenizeWords(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const raw of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (/[0-9]/.test(raw) || raw.length < 2 || raw.length > 20) continue;
    counts[raw] = (counts[raw] ?? 0) + 1;
  }
  return counts;
}
