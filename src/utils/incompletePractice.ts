/**
 * 未完成练习的展示与提醒规则（首页弹窗、日历页侧栏共用）。
 * 纯函数，时间一律按本地日期 / 本地时间理解。
 */
import { formatDate, formatDuration, formatRelative, formatWeekday, instantMs, localToday } from './datetime.ts';

/** 计算进度所需的会话字段（与 PracticeSession 对应） */
export interface IncompleteSessionLike {
  scheduleDate: string;
  updatedAt: string;
  startTime: string;
  wordStates?: { stepAttempts: number[]; reviewCorrect?: boolean | null; isReview?: boolean }[];
}

/**
 * 进度：按“题”计，与练习页的进度一致——每个词三步各一题 + 当轮小测一题
 * （练习队列是交错的，按“练完的词”算会长期显示 0）。答错重考会在练习中另外加题，这里不计。
 */
export function practiceProgress(session: IncompleteSessionLike): { done: number; total: number; words: number } {
  const states = session.wordStates ?? [];
  // 复习词只考第三步，算一题
  const done = states.reduce(
    (n, w) =>
      n +
      (w.isReview
        ? Number((w.stepAttempts?.[2] ?? 0) > 0)
        : (w.stepAttempts ?? []).filter(a => a > 0).length + (w.reviewCorrect == null ? 0 : 1)),
    0
  );
  const total = states.reduce((n, w) => n + (w.isReview ? 1 : 4), 0);
  return { done, total, words: states.length };
}

/** 日程日期相对今天：已过期 / 今天 / 提前练 */
export type ScheduleTiming = 'overdue' | 'today' | 'ahead';

export function scheduleTiming(scheduleDate: string, today: string = localToday()): ScheduleTiming {
  const date = scheduleDate.slice(0, 10);
  if (date < today) return 'overdue';
  return date === today ? 'today' : 'ahead';
}

const TIMING_TEXT: Record<ScheduleTiming, string> = { overdue: '已过期', today: '今天', ahead: '提前练' };

/** “10月11日 周日（提前练）”；日程日期是本地日历日期，不做时区换算 */
export function scheduleLabel(scheduleDate: string, today: string = localToday()): string {
  const date = scheduleDate.slice(0, 10);
  const timing = scheduleTiming(scheduleDate, today);
  const day = formatDate(date).replace(/^\d+年/, '');
  return timing === 'today' ? `今天（${day}）` : `${day} ${formatWeekday(date)}（${TIMING_TEXT[timing]}）`;
}

/** 上次练习时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前 / 日期 */
export function lastActiveLabel(iso: string, now: Date = new Date()): string {
  return formatRelative(iso, now);
}

/** 练习时长（毫秒）：“11 秒” / “3 分 20 秒” / “1 小时 5 分” */
export function formatActiveTime(ms: number | null | undefined): string {
  return formatDuration(ms);
}

/** 最近练过的排前面 */
export function sortByLastActive<T extends IncompleteSessionLike>(sessions: T[]): T[] {
  const key = (s: T) => instantMs(s.updatedAt) || instantMs(s.startTime);
  return [...sessions].sort((a, b) => key(b) - key(a));
}

// 首页弹窗只在应用启动后第一次进首页时提醒一次：
// 之后回到首页（尤其是刚从练习页退出）不再打断；入口留在日历页「未完成练习」。
let launchReminderClaimed = false;

/** 本次启动是否还该弹提醒；第一次调用返回 true，之后都返回 false */
export function claimLaunchReminder(): boolean {
  if (launchReminderClaimed) return false;
  launchReminderClaimed = true;
  return true;
}
