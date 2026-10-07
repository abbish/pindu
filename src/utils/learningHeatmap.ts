/**
 * 学习热力图网格（纯函数，有 node 测试）。
 * 列 = 周（周一开头），行 = 周一…周日；最后一列包含今天，今天之后的格子标记为 future。
 */
import { toLocalDateKey } from './datetime.ts';

export { toLocalDateKey };

export interface HeatmapActivity {
  /** 本地日期 YYYY-MM-DD */
  date: string;
  practiced_words: number;
  mastered_words: number;
}

export interface HeatmapCell {
  /** 本地日期 YYYY-MM-DD */
  date: string;
  practiced: number;
  mastered: number;
  /** 0 = 无学习，1–4 = 由浅到深 */
  level: 0 | 1 | 2 | 3 | 4;
  isToday: boolean;
  /** 今天之后（最后一周的剩余天数），不显示 */
  future: boolean;
}

export interface HeatmapGrid {
  /** weeks[列][行]，行 0 = 周一 */
  weeks: HeatmapCell[][];
  /** 月份标签：在该月第一次出现的列上显示 */
  monthLabels: { column: number; label: string }[];
  /** 区间内（不含 future）有学习的天数与练习单词合计 */
  activeDays: number;
  totalPracticed: number;
}

/** 按区间最大值四等分映射到 1–4 级；0 为无学习 */
export function heatLevel(count: number, max: number): HeatmapCell['level'] {
  if (count <= 0 || max <= 0) return 0;
  const level = Math.ceil((count / max) * 4);
  return Math.min(4, Math.max(1, level)) as HeatmapCell['level'];
}

/** 构建 `weekCount` 周的网格，最后一列为今天所在周 */
export function buildHeatmap(activity: HeatmapActivity[], today: Date, weekCount: number): HeatmapGrid {
  const byDate = new Map(activity.map((a) => [a.date, a]));
  const todayKey = toLocalDateKey(today);
  const mondayOffset = (today.getDay() + 6) % 7; // 周一 = 0
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset - (weekCount - 1) * 7);

  const days: Omit<HeatmapCell, 'level'>[] = [];
  for (let i = 0; i < weekCount * 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = toLocalDateKey(d);
    const a = byDate.get(key);
    days.push({
      date: key,
      practiced: a?.practiced_words ?? 0,
      mastered: a?.mastered_words ?? 0,
      isToday: key === todayKey,
      future: key > todayKey,
    });
  }

  const visible = days.filter((d) => !d.future);
  const max = Math.max(0, ...visible.map((d) => d.practiced));
  const weeks: HeatmapCell[][] = [];
  const monthLabels: HeatmapGrid['monthLabels'] = [];
  let lastMonth = -1;
  for (let w = 0; w < weekCount; w++) {
    const column = days.slice(w * 7, w * 7 + 7).map((d) => ({ ...d, level: d.future ? 0 : heatLevel(d.practiced, max) }) as HeatmapCell);
    weeks.push(column);
    const month = Number(column[0].date.slice(5, 7));
    if (month !== lastMonth) {
      monthLabels.push({ column: w, label: `${month}月` });
      lastMonth = month;
    }
  }

  return {
    weeks,
    monthLabels,
    activeDays: visible.filter((d) => d.practiced > 0).length,
    totalPracticed: visible.reduce((s, d) => s + d.practiced, 0),
  };
}
