/**
 * 练习计时（纯逻辑）：按时间戳计算，不依赖定时器按时触发（窗口隐藏时 WebView 会节流定时器）。
 * - total：从进入页面算起的墙钟时间（含暂停），加上恢复会话时已落库的时长
 * - active：只计未暂停的时间，加上已落库的有效时长
 */
export interface PracticeClock {
  /** 恢复会话时已落库的时长（毫秒） */
  baseTotal: number;
  baseActive: number;
  /** 本次进入页面的时间 */
  visitStart: number;
  /** 本次进入后已结束的“未暂停”时段累计 */
  activeAccum: number;
  /** 当前“未暂停”时段的开始时间；暂停中为 null */
  runStart: number | null;
}

export function startClock(now: number, baseTotal = 0, baseActive = 0): PracticeClock {
  return { baseTotal, baseActive: Math.min(baseActive, baseTotal || baseActive), visitStart: now, activeAccum: 0, runStart: now };
}

export function pauseClock(c: PracticeClock, now: number): PracticeClock {
  if (c.runStart === null) return c;
  return { ...c, activeAccum: c.activeAccum + Math.max(0, now - c.runStart), runStart: null };
}

export function resumeClock(c: PracticeClock, now: number): PracticeClock {
  return c.runStart === null ? { ...c, runStart: now } : c;
}

export function activeTime(c: PracticeClock, now: number): number {
  return c.baseActive + c.activeAccum + (c.runStart === null ? 0 : Math.max(0, now - c.runStart));
}

export function totalTime(c: PracticeClock, now: number): number {
  return Math.max(c.baseTotal + Math.max(0, now - c.visitStart), activeTime(c, now));
}
