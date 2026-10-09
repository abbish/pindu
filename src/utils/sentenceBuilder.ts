/**
 * 听句拼句：把一句英文拆成单词卡（打乱，混入几个干扰词），用户按顺序点选拼回原句。纯函数，便于测试。
 */

/** 句子里的词（保留词内撇号与连字符，去掉标点） */
export function sentenceWords(sentence: string): string[] {
  return sentence
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ''))
    .filter(Boolean);
}

/** 比较用：小写、统一撇号 */
export const normalizeWord = (w: string) => w.toLowerCase().replace(/[’‘]/g, "'");

/** 可预测的伪随机（同一句每次打乱一致，测试可复现） */
function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface WordTile {
  /** 卡片 id（同一个词出现两次也能区分） */
  id: number;
  text: string;
}

/**
 * 单词卡：句子里的词 + 最多 `distractors` 个干扰词（取自其它句子、不与本句重复），打乱顺序。
 * 句子很短（≤ 2 个词）时不加干扰词。
 */
export function buildTiles(sentence: string, otherSentences: string[], distractors = 3): WordTile[] {
  const words = sentenceWords(sentence);
  const own = new Set(words.map(normalizeWord));
  const pool: string[] = [];
  if (words.length > 2) {
    for (const other of otherSentences) {
      for (const w of sentenceWords(other)) {
        const n = normalizeWord(w);
        if (!own.has(n) && !pool.some((p) => normalizeWord(p) === n) && w.length > 1) pool.push(w);
      }
    }
  }
  const random = seeded(hash(sentence));
  const extra = pool
    .map((w) => ({ w, k: random() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, distractors)
    .map((x) => x.w);
  return [...words, ...extra]
    .map((text, id) => ({ id, text, k: random() }))
    .sort((a, b) => a.k - b.k)
    .map(({ id, text }) => ({ id, text }));
}

export interface BuildCheck {
  correct: boolean;
  /** 每个已选词是否在正确的位置 */
  marks: boolean[];
}

/** 核对拼出的句子（忽略大小写与标点） */
export function checkBuild(sentence: string, picked: string[]): BuildCheck {
  const answer = sentenceWords(sentence).map(normalizeWord);
  const marks = picked.map((w, i) => normalizeWord(w) === answer[i]);
  return { correct: picked.length === answer.length && marks.every(Boolean), marks };
}
