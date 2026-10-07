/**
 * 学习计划参数（自适应间隔复习，DECISIONS D20）。
 * 用户只选「每天新词数」和开始日期；学新词天数、巩固期、复习都由系统计算。
 * 与后端 `services/study_planning.rs`、`services/srs.rs` 的规则保持一致。
 */
import { addLocalDays } from './datetime.ts';

/** 每天新词数选项 */
export const DAILY_NEW_WORDS_OPTIONS: { value: number; label: string; hint: string }[] = [
  { value: 3, label: '3 个', hint: '低年级 / 零基础，轻松坚持' },
  { value: 5, label: '5 个', hint: '小学生推荐' },
  { value: 8, label: '8 个', hint: '中学生 / 有一定基础' },
  { value: 10, label: '10 个', hint: '成人推荐' },
  { value: 15, label: '15 个', hint: '每天时间较充裕' },
  { value: 20, label: '20 个', hint: '强化，复习量会明显增加' },
  { value: 30, label: '30 个', hint: '冲刺，需要每天坚持复习' },
];

export const DEFAULT_DAILY_NEW_WORDS = 10;

/** 巩固期：最后一批词按 1 → 3 → 7 天复习三次升到“掌握”需要的天数（后端 CONSOLIDATION_DAYS） */
export const CONSOLIDATION_DAYS = 11;

/** 估算时长（分钟 / 词）：新词完整走一遍看说盖写查，复习只做一次听写 */
const MINUTES_PER_NEW_WORD = 1.5;
const MINUTES_PER_REVIEW = 0.4;

export interface PlanEstimate {
  /** 学新词的天数 */
  learningDays: number;
  /** 计划总天数（学新词 + 巩固期） */
  periodDays: number;
  /** 结束日期 YYYY-MM-DD（start 为空时为空串） */
  endDate: string;
  /** 学新词期间每天大约的练习分钟数（新词 + 稳定后的复习量） */
  minutesPerDay: number;
}

/** 生成规划前的预估（实际以后端规划结果为准） */
export function estimatePlan(totalWords: number, dailyNewWords: number, startDate: string): PlanEstimate {
  const daily = Math.max(1, dailyNewWords);
  const learningDays = Math.max(1, Math.ceil(Math.max(0, totalWords) / daily));
  const periodDays = learningDays + CONSOLIDATION_DAYS;
  // 稳定期每天到期的复习约为每天新词数的 2 倍（1、3、7 天三个间隔叠加后的平均量）
  const minutesPerDay = Math.round(daily * MINUTES_PER_NEW_WORD + daily * 2 * MINUTES_PER_REVIEW);
  return {
    learningDays,
    periodDays,
    endDate: startDate ? addLocalDays(startDate, periodDays - 1) : '',
    minutesPerDay,
  };
}
