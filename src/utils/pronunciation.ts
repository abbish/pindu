/**
 * 发音评估结果怎么给学习者看（纯函数，有 node 测试）：
 * - 三档：读得很好 / 还差一点 / 再试试，门槛按严格程度（在 speechocean762 上按人工评分标定，见
 *   .claude/work/pronunciation-spike/evidence.md：宽松档读得好的词只有 8% 会被提示）；
 * - 不准的音对到自然拼读的字母组合上（th、ee…），再给一句怎么读的提示。
 */
import type { PhoneAssessment, WordAssessment } from '../types/pronunciation';

export type Strictness = 'lenient' | 'standard' | 'strict';
export type Band = 'good' | 'close' | 'retry';

/** [读得很好 ≥, 还差一点 ≥] */
const THRESHOLDS: Record<Strictness, [number, number]> = {
  lenient: [85, 70],
  standard: [92, 82],
  strict: [95, 87],
};
/** 一个音低于这个分数才指出来（宽松档更少指出） */
const PHONE_FLAG: Record<Strictness, number> = { lenient: 50, standard: 60, strict: 70 };

export const BAND_LABEL: Record<Band, string> = { good: '读得很好', close: '还差一点', retry: '再试试' };
/** 三档的颜色（标签、逐词标色共用） */
export const BAND_STYLE: Record<Band, string> = {
  good: 'bg-success-soft text-success',
  close: 'bg-warning-soft text-warning',
  retry: 'bg-muted text-foreground',
};

/** 严格程度：设置里选了就用选的；「自动」时小学生宽松，其余标准 */
export function strictnessFor(learner: string | undefined, setting: Strictness | 'auto' = 'auto'): Strictness {
  if (setting !== 'auto') return setting;
  return learner === 'primary' ? 'lenient' : 'standard';
}

export function bandOf(score: number, strictness: Strictness): Band {
  const [good, close] = THRESHOLDS[strictness];
  return score >= good ? 'good' : score >= close ? 'close' : 'retry';
}

/** 一个音常见的拼写（长的在前）；元音拼法很多，只列常见的 */
const SPELLINGS: Record<string, string[]> = {
  θ: ['th'],
  ð: ['th'],
  ʃ: ['sh', 'ti', 'ci', 'ssi', 'ss', 's'],
  ʒ: ['si', 's', 'g'],
  tʃ: ['tch', 'ch', 't'],
  dʒ: ['dge', 'ge', 'g', 'j'],
  ŋ: ['ng', 'n'],
  ɹ: ['wr', 'rr', 'r'],
  l: ['ll', 'l'],
  f: ['ph', 'ff', 'gh', 'f'],
  k: ['ck', 'ch', 'k', 'c', 'q', 'x'],
  s: ['ss', 'sc', 'ce', 'c', 's', 'x'],
  z: ['zz', 'z', 's', 'x'],
  v: ['v', 'f'],
  w: ['wh', 'w', 'u', 'o'],
  j: ['y', 'i', 'u'],
  h: ['wh', 'h'],
  g: ['gg', 'gu', 'g', 'x'],
  m: ['mm', 'mb', 'm'],
  n: ['nn', 'kn', 'gn', 'n'],
  p: ['pp', 'p'],
  b: ['bb', 'b'],
  d: ['dd', 'ed', 'd'],
  t: ['tt', 'ed', 't'],
  i: ['ee', 'ea', 'ie', 'ei', 'ey', 'e', 'y', 'i'],
  ɪ: ['i', 'y', 'e', 'a'],
  ɛ: ['ea', 'ai', 'e', 'a'],
  æ: ['a'],
  ɑ: ['ar', 'a', 'o'],
  ʌ: ['ou', 'u', 'o'],
  ɔ: ['augh', 'ough', 'aw', 'au', 'or', 'oa', 'a', 'o'],
  ʊ: ['oo', 'ou', 'u'],
  u: ['oo', 'ew', 'ue', 'ui', 'ou', 'u', 'o'],
  eɪ: ['eigh', 'ay', 'ai', 'ey', 'ea', 'a'],
  aɪ: ['igh', 'ie', 'y', 'i'],
  oʊ: ['ough', 'oa', 'ow', 'oe', 'o'],
  aʊ: ['ough', 'ow', 'ou'],
  ɔɪ: ['oy', 'oi'],
  ə: ['ou', 'a', 'e', 'i', 'o', 'u'],
  ɜɹ: ['ear', 'ir', 'er', 'ur', 'or'],
};

/** 辅音在自然拼读里的叫法（其余辅音的 IPA 就是那个字母） */
const CONSONANT_LABEL: Record<string, string> = { θ: 'th', ð: 'th', ʃ: 'sh', ʒ: 'zh', tʃ: 'ch', dʒ: 'j', ŋ: 'ng', ɹ: 'r', j: 'y' };

/** 学习者看得懂的写法：辅音用拼读里的叫法，元音用音标 */
export function soundLabel(ipa: string): string {
  if (ipa === '') return '';
  if (CONSONANT_LABEL[ipa]) return CONSONANT_LABEL[ipa];
  return /^[bdfghklmnpstvwz]$/.test(ipa) ? ipa : `/${ipa}/`;
}

/**
 * 每个音落在第几个拼读块：按顺序在单词字母里找这个音的常见拼写（找不到时跳过一两个不发音的字母再找，如 make 的 e）。
 * 对不上的音为 null（界面不标颜色，只在提示里说）。
 */
export function phoneSegments(segments: string[], phones: string[]): (number | null)[] {
  const letters = segments.join('').toLowerCase();
  const owner: number[] = [];
  segments.forEach((s, i) => {
    for (let k = 0; k < s.length; k++) owner.push(i);
  });
  let pos = 0;
  return phones.map((ph) => {
    const spellings = SPELLINGS[ph] ?? [];
    for (let skip = 0; skip <= 2 && pos + skip < letters.length; skip++) {
      const at = pos + skip;
      const hit = spellings.find((sp) => letters.startsWith(sp, at));
      if (hit) {
        pos = at + hit.length;
        return owner[at] ?? null;
      }
    }
    return null;
  });
}

/** 常见读偏的说法（中国学习者常见：th、v/w、r/l、前后鼻音、æ/ɛ、长短 i） */
const TIPS: Record<string, string> = {
  'θ>s': '舌尖轻放在上下齿之间，往外送气',
  'θ>f': '用舌尖，不是用嘴唇：舌尖放在上下齿之间',
  'θ>t': '舌尖放在上下齿之间送气，不要顶住',
  'ð>d': '舌尖放在上下齿之间，声带振动',
  'ð>z': '舌尖放在上下齿之间，声带振动',
  'v>w': '上齿轻咬下唇再发声',
  'v>f': '上齿轻咬下唇，声带要振动',
  'w>v': '双唇收圆向前，不要碰到牙齿',
  'ɹ>l': '舌尖向上卷，不要碰到上颚',
  'ɹ>w': '舌尖向上卷，嘴唇别太圆',
  'l>n': '舌尖顶住上齿龈，气从舌头两边出来',
  'l>ɹ': '舌尖顶住上齿龈',
  'n>ŋ': '收尾时舌尖顶住上齿龈，不要用舌根',
  'n>l': '舌尖顶住上齿龈，气从鼻子出来',
  'ŋ>n': '收尾时舌根抬起，气从鼻子出来',
  'æ>ɛ': '嘴再张大一些，舌头放低',
  'æ>ʌ': '嘴角往两边拉，嘴张大',
  'i>ɪ': '拉长一点，嘴角往两边',
  'ɪ>i': '短一点、放松，不要拉长',
  'ʃ>s': '嘴唇往前撅，舌头往后一点',
  's>ʃ': '舌尖靠前，嘴唇不要撅',
  'z>s': '声带要振动',
  'dʒ>tʃ': '声带要振动',
  'eɪ>ɛ': '从 e 滑到 i，读成两个音的滑动',
  'oʊ>ɔ': '从 o 滑到 u，嘴唇慢慢收圆',
  'aɪ>æ': '从 a 滑到 i',
};

/** 一个读偏的音怎么说：听起来像什么 + 怎么读（没有专门说法时只说像什么） */
export function phoneTip(phone: PhoneAssessment): string {
  const target = soundLabel(phone.ipa);
  if (phone.heardAs === '') return `${target} 好像没读出来，读完整`;
  if (!phone.heardAs) return `${target} 还可以更准`;
  const like = `${target} 听起来${phone.score >= 60 ? '有点' : ''}像 ${soundLabel(phone.heardAs)}`;
  const tip = TIPS[`${phone.ipa}>${phone.heardAs}`];
  return tip ? `${like}：${tip}` : like;
}

/**
 * 要指出来的音（按严格程度），最多 2 个，分最低的在前。
 * 明显读成常见读偏的（th→s 等）在标准、严格时也提醒，宽松时不提（人工评分里这类大多算可以接受）
 */
export function flaggedPhones(word: WordAssessment, strictness: Strictness): (PhoneAssessment & { index: number })[] {
  return word.phones
    .map((p, index) => ({ ...p, index }))
    .filter((p) => p.score < PHONE_FLAG[strictness] || (p.likelyConfused && strictness !== 'lenient'))
    .sort((a, b) => a.score - b.score)
    .slice(0, 2);
}

/** 一句话按评估结果切开：词带它的档（不能评分的词为 null），词之间的空格与标点原样保留 */
export interface SentencePiece {
  text: string;
  /** 是词时为它在评估结果里的序号 */
  word: number | null;
  band: Band | null;
}

/** 与后端拆词一致（pronunciation::words_of）：字母、数字、撇号连在一起，含字母的才算词 */
const WORD_RE = /[\p{L}\p{N}'’]+/gu;

export function sentencePieces(text: string, words: WordAssessment[], strictness: Strictness): SentencePiece[] {
  const pieces: SentencePiece[] = [];
  let last = 0;
  let index = 0;
  for (const m of text.matchAll(WORD_RE)) {
    if (!/\p{L}/u.test(m[0])) continue;
    const at = m.index ?? 0;
    if (at > last) pieces.push({ text: text.slice(last, at), word: null, band: null });
    const w = words[index];
    pieces.push({ text: m[0], word: index, band: w?.score != null ? bandOf(w.score, strictness) : null });
    index += 1;
    last = at + m[0].length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last), word: null, band: null });
  return pieces;
}

/** 一句话里最该练的词（分最低、有指出的音），最多 `max` 个，每个带一句提示 */
export function sentenceTips(words: WordAssessment[], strictness: Strictness, max = 2): { word: string; tip: string }[] {
  return words
    .filter((w) => w.score !== null && bandOf(w.score, strictness) !== 'good')
    .map((w) => ({ w, flagged: flaggedPhones(w, strictness) }))
    .filter((x) => x.flagged.length > 0)
    .sort((a, b) => (a.w.score ?? 0) - (b.w.score ?? 0))
    .slice(0, max)
    .map(({ w, flagged }) => ({ word: w.word, tip: phoneTip(flagged[0]) }));
}

/** 听后复述：原句的每个词有没有说出来 */
export interface RetellPiece {
  text: string;
  /** 是词时：说出来了没有（标点空格为 null） */
  hit: boolean | null;
}

/** 比较用：小写、去掉撇号（where's 与 wheres 算同一个） */
const norm = (w: string) => w.toLowerCase().replace(/['’]/g, '');

/** 原句与说出的话逐词对照（最长公共子序列，不分大小写、忽略标点与撇号）；hits / total 是说对的词数 */
export function retellDiff(original: string, said: string): { pieces: RetellPiece[]; hits: number; total: number } {
  const tokens = [...original.matchAll(WORD_RE)].filter((m) => /\p{L}/u.test(m[0]));
  const a = tokens.map((m) => norm(m[0]));
  const b = [...said.matchAll(WORD_RE)].map((m) => norm(m[0])).filter(Boolean);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hit = new Array<boolean>(a.length).fill(false);
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      hit[i] = true;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const pieces: RetellPiece[] = [];
  let last = 0;
  tokens.forEach((m, k) => {
    const at = m.index ?? 0;
    if (at > last) pieces.push({ text: original.slice(last, at), hit: null });
    pieces.push({ text: m[0], hit: hit[k] });
    last = at + m[0].length;
  });
  if (last < original.length) pieces.push({ text: original.slice(last), hit: null });
  return { pieces, hits: hit.filter(Boolean).length, total: a.length };
}

/**
 * 专项练音用的最小对立词：每个音给几组「只差这一个音」的词（前一个含这个音，后一个是常读成的那个），
 * 练的时候两个都读，听出、读出区别。只收中国学习者常混的音。
 */
export const MINIMAL_PAIRS: Record<string, [string, string][]> = {
  θ: [['think', 'sink'], ['thick', 'sick'], ['mouth', 'mouse'], ['three', 'tree']],
  ð: [['they', 'day'], ['then', 'den'], ['breathe', 'breeze']],
  v: [['very', 'wary'], ['vest', 'west'], ['vine', 'wine']],
  w: [['wet', 'vet'], ['west', 'vest']],
  ɹ: [['right', 'light'], ['read', 'lead'], ['rice', 'lice'], ['road', 'load']],
  l: [['light', 'right'], ['lead', 'read'], ['night', 'light']],
  n: [['night', 'light'], ['no', 'low'], ['knee', 'lee']],
  æ: [['bad', 'bed'], ['man', 'men'], ['cat', 'cut'], ['bag', 'beg']],
  ɛ: [['bed', 'bad'], ['pen', 'pan'], ['set', 'sat']],
  ɪ: [['ship', 'sheep'], ['sit', 'seat'], ['live', 'leave'], ['fill', 'feel']],
  i: [['sheep', 'ship'], ['seat', 'sit'], ['leave', 'live']],
  ʊ: [['full', 'fool'], ['pull', 'pool'], ['look', 'Luke']],
  u: [['fool', 'full'], ['pool', 'pull']],
  ʃ: [['ship', 'sip'], ['she', 'see'], ['shoe', 'sue']],
  s: [['sink', 'think'], ['sip', 'ship']],
  z: [['zoo', 'sue'], ['prize', 'price'], ['buzz', 'bus']],
  dʒ: [['jeep', 'cheap'], ['joke', 'choke']],
  tʃ: [['chip', 'ship'], ['cheap', 'jeep']],
  ŋ: [['sing', 'sin'], ['thing', 'thin'], ['wing', 'win']],
  f: [['fan', 'pan'], ['fine', 'pine'], ['coffee', 'copy']],
  p: [['pan', 'fan'], ['pig', 'big']],
  b: [['big', 'pig'], ['bat', 'pat']],
  d: [['bed', 'bet'], ['dog', 'dock']],
  t: [['bet', 'bed'], ['tie', 'die']],
  k: [['back', 'bag'], ['coat', 'goat']],
  g: [['bag', 'back'], ['goat', 'coat']],
  h: [['hat', 'at'], ['hair', 'air']],
};
