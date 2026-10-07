/**
 * 计划时间进度的唯一前端实现。口径：截至今天开始时已过去的自然日 / 总天数（含首尾），
 * 与后端 statistics_repository 的 time_progress_percentage 一致（第 k 天 = (k-1)/n）。
 * 起止日期是本地日历日期，按本地日解析（不能 new Date('YYYY-MM-DD')：那是 UTC 零点，西半球会差一天）。
 */
import { localDaysBetween, parseLocalDate } from './datetime.ts';

/**
 * 时间进度（%）：开始日当天为 0，结束日之后为 100；按自然日计算
 * @param today 用于测试注入，默认当前时间
 */
export function calculateTimeProgress(
  startDate?: string | null,
  endDate?: string | null,
  today: Date = new Date()
): number {
  const start = parseLocalDate(startDate?.slice(0, 10));
  const end = parseLocalDate(endDate?.slice(0, 10));
  if (!start || !end) return 0;

  const totalDays = localDaysBetween(start, end) + 1; // 含首尾
  const passedDays = localDaysBetween(start, today); // 开始日当天为 0
  if (totalDays <= 0 || passedDays < 0) return 0;
  if (passedDays >= totalDays) return 100;
  return (passedDays / totalDays) * 100;
}
