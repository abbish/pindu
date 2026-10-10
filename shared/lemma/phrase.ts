// 词组在原文里的位置（D47 B2）。两种来源：
// 1. 标注的写法 forms：AI 写短文 / 导入材料 / 视频规划 / 提取单词时给出它在原文里的实际写法（picked it up），
//    或读原文时划选的原文；按原样在文中找。
// 2. 没有标注时：各词连着出现、每个词可以是任意词形（gave up、made a decision；词形由词形库判断）。
//    拆开用的写法（pick it up）只有标注了才认，不靠规则猜。
// 词组条目的书写约定：sb / sth / one's / oneself 代表「某人 / 某物」，在文中对应 1–3 个词（take care of sb）。
// Rust 端 src-tauri/src/lemma.rs 同一实现，两端用 cases.json 核对。

import { isFormOf } from './morphy.ts';

/** 词组条目里代表「某人 / 某物」的记号（词典的书写约定） */
export const NOTATION = new Set(['sb', 'sth', "one's", 'oneself']);

/** 把一串词展开成比较用的小写词（连字符词拆开：well-known → well known），并记下每个来自原来的第几个词 */
function expand(words: string[]): { parts: string[]; origin: number[] } {
  const parts: string[] = [];
  const origin: number[] = [];
  words.forEach((w, i) => {
    for (const p of w.toLowerCase().replace(/[‘’]/g, "'").split('-')) {
      if (p) {
        parts.push(p);
        origin.push(i);
      }
    }
  });
  return { parts, origin };
}

const split = (text: string) => expand(text.trim().split(/\s+/).filter(Boolean)).parts;

/** 从 tokens[i] 起按词组各词连着匹配（每个词可变形；记号对应 1–3 个词），返回结束位置 */
function matchFrom(tokens: string[], i: number, parts: string[], k: number): number | null {
  if (k === parts.length) return i;
  const part = parts[k];
  if (NOTATION.has(part)) {
    for (let n = 1; n <= 3 && i + n <= tokens.length; n++) {
      const end = matchFrom(tokens, i + n, parts, k + 1);
      if (end !== null) return end;
    }
    return null;
  }
  if (i < tokens.length && isFormOf(tokens[i], part)) return matchFrom(tokens, i + 1, parts, k + 1);
  return null;
}

/** 标注的写法和词组对得上：写法的第一个词是词组第一个词的某种形式，词组的其余词按顺序出现在写法里 */
export function formMatchesPhrase(form: string, phrase: string): boolean {
  const f = split(form);
  const p = split(phrase).filter((w) => !NOTATION.has(w));
  if (f.length === 0 || p.length === 0 || !isFormOf(f[0], p[0])) return false;
  let i = 1;
  for (const part of p.slice(1)) {
    while (i < f.length && !isFormOf(f[i], part)) i++;
    if (i >= f.length) return false;
    i++;
  }
  return true;
}

/**
 * 词组在一串词里出现的位置（[开始, 结束)，按原来的词序号，不重叠）。
 * `forms`：标注的写法（原样在文中找，先于规则）；没有标注或标注没找到时按「连着出现、可变形」匹配。
 */
export function phraseSpans(words: string[], phrase: string, forms: string[] = []): [number, number][] {
  const { parts: tokens, origin } = expand(words);
  const found: [number, number][] = [];
  const take = (start: number, end: number) => {
    if (found.some(([a, b]) => start < b && a < end)) return;
    found.push([start, end]);
  };
  for (const form of forms) {
    const f = split(form);
    if (f.length === 0) continue;
    for (let i = 0; i + f.length <= tokens.length; i++) {
      if (f.every((w, k) => tokens[i + k] === w)) take(i, i + f.length);
    }
  }
  const parts = split(phrase);
  if (parts.length > 0) {
    for (let i = 0; i < tokens.length; ) {
      const end = matchFrom(tokens, i, parts, 0);
      if (end !== null && end > i) {
        take(i, end);
        i = end;
      } else i += 1;
    }
  }
  // 换回原来的词序号（连字符词拆开后合回一个）
  return found
    .sort((a, b) => a[0] - b[0])
    .map(([s, e]) => [origin[s], origin[e - 1] + 1] as [number, number]);
}

/** 这个词是不是词组本身的一部分（不是插入的宾语或记号对应的词） */
export const isPhrasePart = (word: string, phrase: string) => split(phrase).some((p) => !NOTATION.has(p) && isFormOf(word, p));

/** AI 标注的一条写法：词组 + 它在文中的写法 */
export interface PhraseUse {
  phrase: string;
  text: string;
}

/** 标注里属于这个词组、和词组对得上、并且原样出现在这段文字（words）里的写法 */
export function annotatedForms(words: string[], phrase: string, uses: PhraseUse[] = []): string[] {
  const p = phrase.trim().toLowerCase();
  const out: string[] = [];
  for (const u of uses) {
    const form = u.text.trim().replace(/\s+/g, ' ');
    if (u.phrase.trim().toLowerCase() !== p || !form || !formMatchesPhrase(form, phrase)) continue;
    if (phraseSpans(words, '', [form]).length === 0) continue;
    if (!out.some((f) => f.toLowerCase() === form.toLowerCase())) out.push(form);
  }
  return out;
}

/** 这段文字（words）是否用到这个单词或词组（词组可带标注的写法） */
export function usesWord(words: string[], word: string, forms: string[] = []): boolean {
  const w = word.trim();
  if (!/[\s-]/.test(w)) return words.some((t) => isFormOf(t, w));
  return phraseSpans(words, w, forms).length > 0;
}
