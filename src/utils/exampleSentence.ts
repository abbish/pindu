import { isPhrase, isPhrasePart, targetSpans, tokenize } from './passage';

/** 例句片段：`isTarget` 为该单词（或其常见词形）出现的位置 */
export interface SentencePart {
  text: string;
  isTarget: boolean;
}

/**
 * 把例句按目标单词切分，用于高亮（练习第一步）或挖空（第二步）。
 * 识别规则与 agent 工具 `sentenceContainsWord` 一致：单词本身及复数、过去式、-ing、比较级等常见变形。
 */
export function splitExampleSentence(sentence: string, word: string): SentencePart[] {
  const w = word.trim().toLowerCase();
  if (!w) return [{ text: sentence, isTarget: false }];
  if (isPhrase(w)) return splitByPhrase(sentence, w);
  const stems = [w];
  if (/[ey]$/.test(w) && w.length > 2) stems.push(w.slice(0, -1));
  const isTarget = (token: string) => {
    const bare = token.toLowerCase().replace(/'s$/, '');
    return stems.some(stem => bare.startsWith(stem) && bare.length - w.length <= 4);
  };

  const parts: SentencePart[] = [];
  let last = 0;
  for (const match of sentence.matchAll(/[A-Za-z]+(?:'[A-Za-z]+)?/g)) {
    const token = match[0];
    const start = match.index ?? 0;
    if (!isTarget(token)) continue;
    // 所有格 's 不算在单词里，保留在原文中
    const core = token.replace(/'s$/i, '');
    if (start > last) parts.push({ text: sentence.slice(last, start), isTarget: false });
    parts.push({ text: core, isTarget: true });
    last = start + core.length;
  }
  if (last < sentence.length) parts.push({ text: sentence.slice(last), isTarget: false });
  return parts;
}

/** 挖空后的例句（目标词替换为等长下划线，最少 3 个） */
export function maskExampleSentence(sentence: string, word: string): string {
  return splitExampleSentence(sentence, word)
    .map(p => (p.isTarget ? '_'.repeat(Math.max(3, p.text.length)) : p.text))
    .join('');
}

/** 词组：词组里的每个词都是目标（可变形、可拆开，插入的宾语与空格不算） */
function splitByPhrase(sentence: string, phrase: string): SentencePart[] {
  const tokens = tokenize(sentence);
  const spans = targetSpans(tokens, [phrase]);
  const parts: SentencePart[] = [];
  for (const t of tokens) {
    const isTarget = t.kind === 'word' && spans.has(t.index) && isPhrasePart(t.text, phrase);
    const prev = parts[parts.length - 1];
    if (prev && prev.isTarget === isTarget && !isTarget) prev.text += t.text;
    else parts.push({ text: t.text, isTarget });
  }
  return parts;
}
