/**
 * 对话区的「贴底跟随」：新内容到来时跟着滚到底；学习者主动往上翻就停止跟随，滚回底部（或点「回到最新」）再接着跟。纯函数，有 node 测试。
 */

/** 离底部多近算「在底部」（px） */
export const NEAR_BOTTOM = 40;

export interface ScrollSample {
  scrollTop: number;
  /** 上一次滚动时的 scrollTop */
  lastScrollTop: number;
  /** 离底部还有多远：scrollHeight - scrollTop - clientHeight */
  distance: number;
}

/**
 * 一次滚动之后是否继续跟随：
 * - 往上滚了且没到底 → 学习者在往回看，停止跟随；
 * - 在底部附近 → 跟随（包括内容变短时浏览器把 scrollTop 收回的情况，那时离底部是 0）；
 * - 其余保持原样（往下滚但还没到底：还在看中间的内容）。
 */
export function nextPinned(pinned: boolean, s: ScrollSample): boolean {
  if (s.scrollTop < s.lastScrollTop - 1 && s.distance > 1) return false;
  if (s.distance <= NEAR_BOTTOM) return true;
  return pinned;
}
