/**
 * 日期与“该练哪个日程”的统一规则（首页、计划列表、计划详情共用）。
 */

import { localToday } from './datetime.ts';

/** 本地日期 YYYY-MM-DD；实现在 utils/datetime.ts，这里保留导出供既有调用方使用 */
export { localToday };

export interface PickableSchedule {
  id: number;
  schedule_date: string;
  /** 日程已练完 */
  completed: boolean;
}

/**
 * 选择要练习的日程：
 * 1. 今天还没练完的日程；
 * 2. 最早的逾期未练完日程（补做）；
 * 3. 今天的日程（已练完，可再练一遍）；
 * 4. 第一个未练完的日程（计划还没到开始日期）；
 * 5. 都练完了：最后一个日程。
 */
export function pickPracticeSchedule<T extends PickableSchedule>(schedules: T[], today: string = localToday()): T | undefined {
  const sorted = [...schedules].sort((a, b) => a.schedule_date.localeCompare(b.schedule_date));
  return (
    sorted.find(s => s.schedule_date === today && !s.completed) ??
    sorted.find(s => s.schedule_date < today && !s.completed) ??
    sorted.find(s => s.schedule_date === today) ??
    sorted.find(s => !s.completed) ??
    sorted[sorted.length - 1]
  );
}
