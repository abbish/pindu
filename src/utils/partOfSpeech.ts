/**
 * 词性：标准缩写、中文名与归一化（纯函数，有 node 测试）。
 * 单词表、单词选择网格、编辑单词、保存分析结果共用。
 */

/** 标准词性缩写 → 中文名 */
export const PART_OF_SPEECH_LABELS: Record<string, string> = {
  'n.': '名词',
  'v.': '动词',
  'adj.': '形容词',
  'adv.': '副词',
  'prep.': '介词',
  'conj.': '连词',
  'int.': '感叹词',
  'pron.': '代词',
  'art.': '冠词',
  'det.': '限定词',
  'num.': '数词',
};

/** 标准词性缩写 → 英文名（保存到 pos_english） */
export const PART_OF_SPEECH_ENGLISH: Record<string, string> = {
  'n.': 'noun',
  'v.': 'verb',
  'adj.': 'adjective',
  'adv.': 'adverb',
  'prep.': 'preposition',
  'conj.': 'conjunction',
  'int.': 'interjection',
  'pron.': 'pronoun',
  'art.': 'article',
  'det.': 'determiner',
  'num.': 'numeral',
};

const ALIASES: Record<string, string> = {
  n: 'n.', noun: 'n.', nouns: 'n.',
  v: 'v.', verb: 'v.', verbs: 'v.',
  adj: 'adj.', adjective: 'adj.', adjectives: 'adj.',
  adv: 'adv.', adverb: 'adv.', adverbs: 'adv.',
  prep: 'prep.', preposition: 'prep.', prepositions: 'prep.',
  conj: 'conj.', conjunction: 'conj.', conjunctions: 'conj.',
  int: 'int.', interjection: 'int.', interjections: 'int.',
  pron: 'pron.', pronoun: 'pron.', pronouns: 'pron.',
  art: 'art.', article: 'art.', articles: 'art.',
  det: 'det.', determiner: 'det.', determiners: 'det.',
  num: 'num.', numeral: 'num.', numerals: 'num.', number: 'num.',
};

/** 把 AI / 用户给出的词性（noun、N.、adj 等）归一为标准缩写；无法识别时为 'n.' */
export function standardizePartOfSpeech(pos: string | null | undefined): string {
  if (!pos) return 'n.';
  return ALIASES[pos.toLowerCase().replace(/\./g, '').trim()] ?? 'n.';
}

/** 词性中文名；未知返回“其他” */
export function partOfSpeechLabel(pos: string | null | undefined): string {
  return (pos && PART_OF_SPEECH_LABELS[pos]) || '其他';
}
