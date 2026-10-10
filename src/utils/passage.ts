/**
 * 短文库的纯函数：选词填空的空位定位、成绩与题组文案。
 * 空位按 sentenceIndex + 词定位到该句中第一个写法一致（忽略大小写）的整词。
 */
import type { PassageAttempt, PassageAttemptBrief, PassageMode, PickDifficulty, PickFrequency, PickStatus, PlanWordScope, QuestionDifficulty, QuestionSetSpec } from '../types/passage';
import { isFormOf } from '../../shared/lemma/morphy';

/** 练习方式文案（唯一 owner） */
export const MODE_LABEL: Record<PassageMode, string> = { reading: '阅读', listening: '听力' };

export type SentencePart = { kind: 'text'; text: string } | { kind: 'blank'; questionId: number; answer: string };

/** 把一句英文按空位拆成片段；找不到的空位忽略 */
export function splitWithBlanks(sentence: string, blanks: { questionId: number; word: string }[]): SentencePart[] {
  const hits: { start: number; end: number; questionId: number; answer: string }[] = [];
  for (const b of blanks) {
    const escaped = b.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 整词：前后不是字母；撇号只有连着字母时才算词的一部分（don't、kids' toys 里的 kids 都能找到，与后端分词一致）
    const re = new RegExp(`(?<![A-Za-z]|[A-Za-z]')${escaped}(?![A-Za-z]|'[A-Za-z])`, 'gi');
    // 与已有空位重叠时继续往后找
    for (const m of sentence.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (hits.some((h) => start < h.end && end > h.start)) continue;
      hits.push({ start, end, questionId: b.questionId, answer: m[0] });
      break;
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const parts: SentencePart[] = [];
  let last = 0;
  for (const h of hits) {
    if (h.start > last) parts.push({ kind: 'text', text: sentence.slice(last, h.start) });
    parts.push({ kind: 'blank', questionId: h.questionId, answer: h.answer });
    last = h.end;
  }
  if (last < sentence.length) parts.push({ kind: 'text', text: sentence.slice(last) });
  return parts;
}

/** 成绩摘要，如“客观题 7/9 · 开放题 3/4” */
export function scoreSummary(a: Pick<PassageAttempt | PassageAttemptBrief, 'objectiveCorrect' | 'objectiveTotal' | 'openScore' | 'openTotal'>): string {
  const parts: string[] = [];
  if (a.objectiveTotal > 0) parts.push(`客观题 ${a.objectiveCorrect}/${a.objectiveTotal}`);
  if (a.openTotal != null) parts.push(a.openScore == null ? '开放题待评分' : `开放题 ${a.openScore}/${a.openTotal}`);
  return parts.join(' · ') || '已完成';
}

/** 题组参数摘要，如“选词填空 5 · 选择 3 · 判断 2 · 开放 1 · 标准” */
export function specSummary(spec: QuestionSetSpec): string {
  return [
    spec.cloze > 0 && `选词填空 ${spec.cloze}`,
    spec.choice > 0 && `选择 ${spec.choice}`,
    spec.trueFalse > 0 && `判断 ${spec.trueFalse}`,
    spec.open > 0 && `开放 ${spec.open}`,
    DIFFICULTY_LABEL[spec.difficulty],
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 英语水平显示名 */
export const LEVEL_LABEL: Record<string, string> = { a1: '入门 A1', a2: '初级 A2', b1: '中级 B1', b2: '中高级 B2' };

/** 计划的取词策略：名称与说明（顺序即界面顺序） */
export const PLAN_SCOPES: { value: PlanWordScope; label: string; description: string }[] = [
  { value: 'wrong', label: '易错词', description: '练习中答错过' },
  { value: 'weak', label: '薄弱词', description: '记忆等级 1–2 级' },
  { value: 'recent', label: '新学词', description: '最近 7 天首次学习' },
  { value: 'upcoming', label: '待复习词', description: '3 天内需要复习' },
  { value: 'mastered', label: '已掌握词', description: '记忆等级 4 级及以上' },
  { value: 'learned', label: '全部已学词', description: '计划中学过的全部单词' },
];

/** AI 选词与单词筛选的选项（新建短文与「设置 → 素材」共用） */
export const PICK_STATUS_OPTIONS: { value: PickStatus; label: string }[] = [
  { value: 'new', label: '未学习' },
  { value: 'learning', label: '学习中' },
  { value: 'wrong', label: '易错' },
  { value: 'mastered', label: '已掌握' },
];
export const PICK_DIFFICULTY_OPTIONS: { value: PickDifficulty | 'any'; label: string }[] = [
  { value: 'easy', label: '较易' },
  { value: 'medium', label: '适中' },
  { value: 'hard', label: '较难' },
  { value: 'any', label: '不限' },
];
export const PICK_FREQUENCY_OPTIONS: { value: PickFrequency | 'any'; label: string }[] = [
  { value: 'common', label: '高频词' },
  { value: 'advanced', label: '含低频词' },
  { value: 'any', label: '不限' },
];

/** 取词策略显示名 */
export const PLAN_SCOPE_LABEL = Object.fromEntries(PLAN_SCOPES.map((s) => [s.value, s.label])) as Record<PlanWordScope, string>;

/** 来源快照里的策略（逗号分隔）→ 显示文字 */
export const scopeDetailLabel = (detail: string | null) =>
  (detail ?? '')
    .split(',')
    .filter(Boolean)
    .map((s) => PLAN_SCOPE_LABEL[s as PlanWordScope] ?? s)
    .join('、');

/** 难度显示名 */
export const DIFFICULTY_LABEL: Record<QuestionDifficulty, string> = { basic: '基础', standard: '标准', advanced: '提高' };

/** token 是否是 word 本身或它的某种形式（词形库 shared/lemma：WordNet 词典 + morphy，与后端 lemma.rs 同一份数据，D47） */
export const inflectionMatches = (token: string, word: string): boolean => isFormOf(token, word);

/** 一句英文拆成片段：单词（带序号）与其它字符（空格、标点） */
export type Token = { kind: 'word'; text: string; index: number } | { kind: 'other'; text: string };

export function tokenize(sentence: string): Token[] {
  const tokens: Token[] = [];
  const re = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
  let last = 0;
  let index = 0;
  for (let m = re.exec(sentence); m; m = re.exec(sentence)) {
    if (m.index > last) tokens.push({ kind: 'other', text: sentence.slice(last, m.index) });
    tokens.push({ kind: 'word', text: m[0], index: index++ });
    last = m.index + m[0].length;
  }
  if (last < sentence.length) tokens.push({ kind: 'other', text: sentence.slice(last) });
  return tokens;
}

/** 这个词对应哪个目标词（含变形）；不是目标词返回 null。词组请用 targetSpans / textUses */
export const targetOf = (token: string, targets: string[]) => targets.filter((t) => !isPhrase(t)).find((t) => inflectionMatches(token, t)) ?? null;

// ==================== 词组（D45，与后端 passage_rules::phrase_spans 同规则） ====================

/** 带空格的是词组 */
export const isPhrase = (text: string) => /\s/.test(text.trim());

/** 词组里代表某人 / 某物的占位词：对应 1–3 个任意词 */
const PLACEHOLDERS = new Set(['sb', 'sth', 'somebody', 'something', 'someone', "one's", "sb's", 'oneself']);
/** 可拆开的两词短语动词的小品词：中间允许插入 1–3 个词（pick it up） */
const PARTICLES = new Set(['up', 'down', 'out', 'off', 'on', 'in', 'away', 'back', 'over', 'around', 'about', 'through', 'along', 'aside']);

function matchFrom(words: string[], i: number, parts: string[], k: number): number | null {
  if (k === parts.length) return i;
  const part = parts[k];
  if (PLACEHOLDERS.has(part)) {
    for (let n = 1; n <= 3 && i + n <= words.length; n++) {
      const end = matchFrom(words, i + n, parts, k + 1);
      if (end !== null) return end;
    }
    return null;
  }
  if (i < words.length && isFormOf(words[i], part)) {
    const end = matchFrom(words, i + 1, parts, k + 1);
    if (end !== null) return end;
  }
  if (k === 1 && parts.length === 2 && PARTICLES.has(part)) {
    for (let skip = 1; skip <= 3 && i + skip < words.length; skip++) {
      if (words[i + skip].toLowerCase() === part) return i + skip + 1;
    }
  }
  return null;
}

/** 词组在一串单词里出现的位置（[开始, 结束)，不重叠）：每个词可变形，可拆开的短语动词中间可插入宾语，占位词对应 1–3 个词 */
export function phraseSpans(words: string[], phrase: string): [number, number][] {
  const parts = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const spans: [number, number][] = [];
  if (parts.length === 0) return spans;
  for (let i = 0; i < words.length; ) {
    const end = matchFrom(words, i, parts, 0);
    if (end !== null && end > i) {
      spans.push([i, end]);
      i = end;
    } else i += 1;
  }
  return spans;
}

/** 这个词是不是词组本身的一部分（不是插入的宾语或占位词对应的词） */
export const isPhrasePart = (word: string, phrase: string) =>
  phrase
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .some((p) => !PLACEHOLDERS.has(p) && isFormOf(word, p));

/** 一句话里是否用到了这个单词或词组（含变形） */
export const textUses = (text: string, target: string) => {
  const words = tokenize(text).flatMap((t) => (t.kind === 'word' ? [t.text] : []));
  return isPhrase(target) ? phraseSpans(words, target).length > 0 : words.some((w) => isFormOf(w, target));
};

/** 一句话里目标词的位置：单词序号 → 所在片段（词组覆盖多个单词，先匹配词组再匹配单词） */
export interface TargetSpan {
  target: string;
  /** 片段起止的单词序号 [start, end) */
  start: number;
  end: number;
}
export function targetSpans(tokens: Token[], targets: string[]): Map<number, TargetSpan> {
  const words = tokens.flatMap((t) => (t.kind === 'word' ? [t.text] : []));
  const out = new Map<number, TargetSpan>();
  const phrases = targets.filter(isPhrase).sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length);
  for (const p of phrases) {
    for (const [start, end] of phraseSpans(words, p)) {
      let free = true;
      for (let i = start; i < end; i++) if (out.has(i)) free = false;
      if (!free) continue;
      for (let i = start; i < end; i++) out.set(i, { target: p, start, end });
    }
  }
  const singles = targets.filter((t) => !isPhrase(t));
  words.forEach((w, i) => {
    if (out.has(i)) return;
    const t = singles.find((s) => isFormOf(w, s));
    if (t) out.set(i, { target: t, start: i, end: i + 1 });
  });
  return out;
}

/**
 * 逐词高亮：当前播放时间落在第几个词。`timings` 是语音服务给的逐词时间（与句中单词按顺序对应）；
 * 两边词数不一致时按比例换算；在两个词之间的停顿里保持上一个词。没有时间返回 null。
 */
export function activeWordIndex(timings: { startMs: number; endMs: number }[] | null | undefined, timeMs: number, wordCount: number): number | null {
  if (!timings || timings.length === 0 || wordCount === 0) return null;
  let hit = -1;
  for (let i = 0; i < timings.length; i++) {
    if (timings[i].startMs <= timeMs) hit = i;
    else break;
  }
  if (hit < 0) return null;
  if (timings.length === wordCount) return hit;
  return Math.min(wordCount - 1, Math.floor((hit * wordCount) / timings.length));
}

/** 挖空用的片段：普通文字，或一个空（答案是原文里的写法，target 是对应的目标词） */
export type BlankPart = { kind: 'text'; text: string } | { kind: 'blank'; answer: string; target: string };

/**
 * 一句话里的目标词挖空（听后回忆等）：单词逐个挖；词组在原文里连着出现时整体挖成一个空（gave up），
 * 中间插了宾语或占位词对应的词时（pick it up）不挖，保留原文。
 */
export function recallBlanks(sentence: string, targets: string[]): BlankPart[] {
  const tokens = tokenize(sentence);
  const spans = targetSpans(tokens, targets);
  const parts: BlankPart[] = [];
  const pushText = (text: string) => {
    const last = parts[parts.length - 1];
    if (last?.kind === 'text') last.text += text;
    else parts.push({ kind: 'text', text });
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const span = t.kind === 'word' ? spans.get(t.index) : undefined;
    if (t.kind === 'other' || !span) {
      pushText(t.text);
      continue;
    }
    if (span.end - span.start === 1) {
      parts.push({ kind: 'blank', answer: t.text, target: span.target });
      continue;
    }
    // 词组：收集到片段结尾，判断是否连着出现
    let j = i;
    const words: string[] = [];
    let text = '';
    while (j < tokens.length) {
      const x = tokens[j];
      if (x.kind === 'word' && x.index >= span.end) break;
      if (x.kind === 'word') words.push(x.text);
      text += x.text;
      j++;
    }
    const trailing = text.match(/[^A-Za-z]+$/)?.[0] ?? '';
    const core = trailing ? text.slice(0, text.length - trailing.length) : text;
    if (words.every((w) => isPhrasePart(w, span.target))) parts.push({ kind: 'blank', answer: core, target: span.target });
    else pushText(core);
    if (trailing) pushText(trailing);
    i = j - 1;
  }
  return parts;
}

const SELECTABLE_VOCAB = /^[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,5}$/;

/**
 * 读原文时选中的文字能不能加成目标词（与后端 valid_vocab 同规则）：一个英文单词（至少 2 个字母）或 2–6 个词的词组，
 * 弯撇号按直撇号处理；已经是目标词的不行（同一个词含变形双向判断：birds 与 bird；同一个词组：gave up 与 give up）。
 */
export function canAddTarget(raw: string, targets: string[]): boolean {
  const text = raw.replace(/[\u2018\u2019]/g, "'").trim().replace(/\s+/g, ' ');
  if (!SELECTABLE_VOCAB.test(text) || text.length > 60) return false;
  if (!isPhrase(text) && text.length < 2) return false;
  return !targets.some((t) => {
    if (t.toLowerCase() === text.toLowerCase()) return true;
    if (isPhrase(t) !== isPhrase(text)) return false;
    return textUses(text, t) || textUses(t, text);
  });
}
