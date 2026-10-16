/**
 * 精听填空：从一句台词里挑几个要听出来的词挖空（重点词汇优先，其次实词；挖得多时也挖读得轻的虚词；不挖人名、数字），
 * 学习者只填这几个词，不用整句打字；核对时忽略大小写、缩写与数字写法。纯函数，便于测试。
 */
import { sentenceWords } from './sentenceBuilder.ts';

/** 读得轻的虚词：漏听最常见 */
const WEAK = new Set(
  'a an the of to and or but for from in on at by as with is are was were be been am have has had do does did can could will would shall should must may might i you he she it we they me him her us them my your his its our their this that these those there some any not so than then if'.split(' ')
);

const CONTRACTIONS: Record<string, string[]> = {
  "it's": ['it', 'is'],
  "that's": ['that', 'is'],
  "there's": ['there', 'is'],
  "here's": ['here', 'is'],
  "what's": ['what', 'is'],
  "who's": ['who', 'is'],
  "he's": ['he', 'is'],
  "she's": ['she', 'is'],
  "let's": ['let', 'us'],
  "can't": ['can', 'not'],
  "won't": ['will', 'not'],
  "shan't": ['shall', 'not'],
};
const SUFFIXES: [RegExp, string][] = [
  [/n't$/, 'not'],
  [/'re$/, 'are'],
  [/'ve$/, 'have'],
  [/'ll$/, 'will'],
  [/'m$/, 'am'],
  [/'d$/, 'would'],
];

const NUMBERS: Record<string, string> = Object.fromEntries(
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'
    .split(' ')
    .map((w, i) => [w, String(i)])
    .concat([
      ['thirty', '30'],
      ['forty', '40'],
      ['fifty', '50'],
      ['sixty', '60'],
      ['seventy', '70'],
      ['eighty', '80'],
      ['ninety', '90'],
      ['hundred', '100'],
    ])
);

/** 一个词比较用的单位（缩写展开成两个） */
function units(word: string): string[] {
  const w = word.toLowerCase().replace(/[’‘]/g, "'").replace(/-/g, '');
  if (CONTRACTIONS[w]) return CONTRACTIONS[w];
  for (const [re, full] of SUFFIXES) if (re.test(w) && w.replace(re, '')) return [w.replace(re, '') === 'ca' ? 'can' : w.replace(re, ''), full];
  return [NUMBERS[w] ?? w];
}

/** 拆词：% 当成 percent */
const words = (text: string) => sentenceWords(text.replace(/%/g, ' percent'));

/** 这个词是不是重点词汇（词汇可以是原形，原句里是变形） */
function isVocab(word: string, vocab: Set<string>): boolean {
  const w = word.toLowerCase();
  if (vocab.has(w)) return true;
  for (const v of vocab) if (!v.includes(' ') && v.length >= 4 && (w.startsWith(v) || (v.endsWith('e') && w.startsWith(v.slice(0, -1))))) return true;
  return false;
}

/** 挖空多少：少（只挖关键词）/ 多（还挖读得轻的虚词，听力真正的难点） */
export type BlankLevel = 'few' | 'many';

/** 一句挖几个空：少——短句 1 个、中等 2 个、长句 3 个；多——大约四成的词 */
export function blankCount(wordCount: number, level: BlankLevel = 'few'): number {
  const few = wordCount < 6 ? 1 : wordCount < 12 ? 2 : 3;
  return level === 'few' ? few : Math.max(few + 1, Math.round(wordCount * 0.4));
}

/**
 * 挑要挖空的词（返回 `sentenceWords(sentence)` 里的序号，从小到大）：重点词汇优先，其次越长的实词越优先；
 * 「多」时实词挖完再挖读得轻的虚词。不挖数字、句中大写的词（多是人名地名）；「少」时也不挖虚词和太短的词。没有合适的词时返回空数组。
 */
export function pickBlanks(sentence: string, vocab: string[] = [], level: BlankLevel = 'few'): number[] {
  const list = sentenceWords(sentence);
  const vocabSet = new Set(vocab.map((v) => v.toLowerCase()));
  const candidates = list
    .map((w, i) => ({ w, i, weak: WEAK.has(w.toLowerCase()) || units(w).every((u) => WEAK.has(u)) }))
    .filter(({ w, i, weak }) => {
      if (/\d/.test(w) || (i > 0 && w[0] !== w[0].toLowerCase())) return false;
      return level === 'many' ? w.length >= 2 || weak : !weak && w.length >= 3;
    })
    .map(({ w, i, weak }) => ({ i, score: (isVocab(w, vocabSet) ? 100 : 0) + (weak ? 0 : 20) + w.length }));
  candidates.sort((a, b) => b.score - a.score || a.i - b.i);
  return candidates
    .slice(0, blankCount(list.length, level))
    .map((c) => c.i)
    .sort((a, b) => a - b);
}

/** 填空时一个空填得对不对（同样忽略大小写、缩写与数字写法） */
export function blankCorrect(answer: string, typed: string): boolean {
  const x = words(answer).flatMap(units);
  const y = words(typed).flatMap(units);
  return x.length > 0 && x.length === y.length && x.every((u, i) => u === y[i]);
}
