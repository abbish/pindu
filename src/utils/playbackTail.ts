import { applyOutput } from './audioOutput.ts';

/**
 * 录音前等放音的尾巴放完：扬声器、蓝牙耳机在声音停下后还会放出最后一点（蓝牙延迟常到 200ms 以上）。
 * 跟读不开回声消除，不等就会把原声 / 朗读的句尾录进去（评分会听到标准读音）。
 * 会放声音的元素经 `trackPlayback` 登记（朗读、原声、视频、听自己的录音），录音开始前（useRecorder）按 `playbackTailMs` 等一会儿；
 * 登记过的元素开始放时按扬声器设置定音量（见 audioOutput）。
 */

/** 放音停下后等这么久再开始录 */
export const PLAYBACK_TAIL_MS = 350;

/** 正在放的元素（收到 playing、还没收到 pause / ended）：刚调用 pause() 时 pause 事件还没到，也算在放 */
const active = new Set<EventTarget>();
const tracked = new WeakSet<EventTarget>();
let lastStop = Number.NEGATIVE_INFINITY;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** 登记一个会放声音的元素（重复登记无妨） */
export function trackPlayback(el: EventTarget | null | undefined) {
  if (!el || tracked.has(el)) return;
  tracked.add(el);
  applyOutput(el);
  el.addEventListener('play', () => applyOutput(el));
  el.addEventListener('playing', () => active.add(el));
  const stopped = () => {
    if (active.delete(el)) lastStop = now();
  };
  for (const name of ['pause', 'ended', 'emptied', 'abort', 'error']) el.addEventListener(name, stopped);
}

/** 现在开始录音前还要等多久（毫秒） */
export function playbackTailMs(at = now()): number {
  if (active.size > 0) return PLAYBACK_TAIL_MS;
  return Math.max(0, Math.ceil(lastStop + PLAYBACK_TAIL_MS - at));
}
