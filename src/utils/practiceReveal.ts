/**
 * 「盖-写」时每项信息给多少（纯逻辑，便于测试）。
 *
 * 三级提示随练习推进逐步减少，版面始终不变：
 * - show：完整显示
 * - hint：只给结构（字母变成格子，如 el-e-phant → __-_-_____），不泄露拼写
 * - hidden：锁定占位，提示“答完显示”
 * 「看·说」、答对与纠正时全部显示（FULL_REVEAL）。
 */
export type RevealLevel = 'show' | 'hint' | 'hidden';

/** 提示等级：1 = 刚学完立刻写；2 = 隔几个词再写；3 = 听写（含当轮小测） */
export type HintLevel = 1 | 2 | 3;

export interface StepReveal {
  /** 英文单词 */
  word: RevealLevel;
  /** 音标 */
  ipa: RevealLevel;
  /** 音节 */
  syllables: RevealLevel;
  /** 拼读块 */
  phonics: RevealLevel;
}

export const FULL_REVEAL: StepReveal = { word: 'show', ipa: 'show', syllables: 'show', phonics: 'show' };

const BY_LEVEL: Record<HintLevel, StepReveal> = {
  // 刚学完：字母格 + 音标 + 音节与拼读块的分段结构
  1: { word: 'hint', ipa: 'show', syllables: 'hint', phonics: 'hint' },
  // 隔了几个词：只剩字母格与音标
  2: { word: 'hint', ipa: 'show', syllables: 'hidden', phonics: 'hidden' },
  // 听写：只有发音与中文
  3: { word: 'hidden', ipa: 'hidden', syllables: 'hidden', phonics: 'hidden' },
};

export function writeReveal(level: HintLevel): StepReveal {
  return BY_LEVEL[level] ?? BY_LEVEL[3];
}

/** 字母替换为 `_`，保留连字符、空格、撇号等分隔，用于“只看结构”的提示 */
export function maskLetters(text: string): string {
  return text.replace(/[A-Za-z]/g, '_');
}
