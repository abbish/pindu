// 参照答案：按提词提示词的规则做确定性分词（小写、仅字母、长度 2–20、focus 模式排除常见功能词）
export const FOCUS_STOPWORDS = new Set(`a an the i you he she it we they me him her us them am is are was were be been being
do does did have has had will would can could should shall may might must in on at to for of with by from up out off over under
and or but so if when then than as not no yes very too also only just now here there one two three four five six seven eight nine ten`.split(/\s+/));

export function referenceWords(text, mode) {
  const counts = new Map();
  // 与数字粘连的片段（如 12th、9:00）整体视为数字，不算单词
  for (const raw of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (/[0-9]/.test(raw) || raw.length < 2 || raw.length > 20) continue;
    if (mode === 'focus' && FOCUS_STOPWORDS.has(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return counts;
}

/** 对比模型输出与参照：召回、精确、频率准确率（大小写合并） */
export function score(reference, extracted) {
  const got = new Map();
  for (const { word, frequency } of extracted) {
    const w = String(word).toLowerCase().trim();
    if (!w) continue;
    got.set(w, (got.get(w) ?? 0) + (Number(frequency) || 0));
  }
  const refWords = [...reference.keys()];
  const hit = refWords.filter(w => got.has(w));
  const extra = [...got.keys()].filter(w => !reference.has(w));
  const freqOk = hit.filter(w => got.get(w) === reference.get(w));
  return {
    reference: refWords.length,
    extracted: got.size,
    recall: +(hit.length / refWords.length).toFixed(3),
    precision: got.size ? +((got.size - extra.length) / got.size).toFixed(3) : 0,
    frequencyAccuracy: hit.length ? +(freqOk.length / hit.length).toFixed(3) : 0,
    missing: refWords.filter(w => !got.has(w)),
    extra,
  };
}
