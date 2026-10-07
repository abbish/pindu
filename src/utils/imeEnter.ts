/**
 * 输入法（IME）回车判断：中文等输入法选词时按的回车不应触发提交。
 *
 * WebKit（macOS / Tauri）在确认选词时会先触发 compositionend、再触发 keydown(Enter)，
 * 此时 `isComposing` 已为 false，所以除了 `isComposing` 与 keyCode 229，还要忽略
 * compositionend 之后极短时间内的回车。
 */
export const IME_ENTER_GUARD_MS = 80;

export interface EnterKeyInfo {
  key: string;
  isComposing: boolean;
  keyCode: number;
}

export function isImeEnter(
  e: EnterKeyInfo,
  composing: boolean,
  lastCompositionEnd: number,
  now: number = Date.now()
): boolean {
  if (e.key !== 'Enter') return false;
  return e.isComposing || composing || e.keyCode === 229 || now - lastCompositionEnd < IME_ENTER_GUARD_MS;
}

/** 拼写答案里混入了非英文字符（多半是忘了切换输入法） */
export function hasNonLatin(text: string): boolean {
  return /[^\x20-\x7E’]/.test(text);
}
