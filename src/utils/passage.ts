/**
 * 短文库的纯函数：选词填空的空位定位、成绩与题组文案。
 * 空位按 sentenceIndex + 词定位到该句中第一个写法一致（忽略大小写）的整词。
 */
import type { PassageAttempt, PassageAttemptBrief, PassageMode, PlanWordScope, QuestionDifficulty, QuestionSetSpec } from '../types/passage';

/** 练习方式文案（唯一 owner） */
export const MODE_LABEL: Record<PassageMode, string> = { reading: '阅读', listening: '听力' };

export type SentencePart = { kind: 'text'; text: string } | { kind: 'blank'; questionId: number; answer: string };

/** 把一句英文按空位拆成片段；找不到的空位忽略 */
export function splitWithBlanks(sentence: string, blanks: { questionId: number; word: string }[]): SentencePart[] {
  const hits: { start: number; end: number; questionId: number; answer: string }[] = [];
  for (const b of blanks) {
    const escaped = b.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![A-Za-z'])${escaped}(?![A-Za-z'])`, 'i');
    const m = re.exec(sentence);
    if (!m) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (hits.some((h) => start < h.end && end > h.start)) continue;
    hits.push({ start, end, questionId: b.questionId, answer: m[0] });
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
  { value: 'wrong', label: '错词', description: '练习时答错过' },
  { value: 'weak', label: '还没记牢的词', description: '记忆等级 1–2 级' },
  { value: 'recent', label: '最近学的词', description: '最近 7 天第一次学' },
  { value: 'upcoming', label: '快到复习的词', description: '3 天内要复习' },
  { value: 'mastered', label: '已经掌握的词', description: '记忆等级 4 级以上' },
  { value: 'learned', label: '全部学过的词', description: '计划里学过的全部单词' },
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

/** token 是否是 word 本身或常见屈折形式（与后端 passage_rules::inflection_matches 同规则） */
export function inflectionMatches(token: string, word: string): boolean {
  const t = token.trim().toLowerCase();
  const w = word.trim().toLowerCase();
  if (!t || !w) return false;
  if (t === w) return true;
  if (['s', 'es', 'ed', 'd', 'ing', 'er', 'est'].some((s) => t === w + s)) return true;
  if (w.endsWith('e') && ['ing', 'ed', 'er', 'est'].some((s) => t === w.slice(0, -1) + s)) return true;
  if (w.endsWith('y') && ['ies', 'ied', 'ier', 'iest'].some((s) => t === w.slice(0, -1) + s)) return true;
  const last = w[w.length - 1];
  return !'aeiouwxy'.includes(last) && ['ing', 'ed', 'er', 'est'].some((s) => t === w + last + s);
}

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

/** 这个词对应哪个目标词（含变形）；不是目标词返回 null */
export const targetOf = (token: string, targets: string[]) => targets.find((t) => inflectionMatches(token, t)) ?? null;

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
