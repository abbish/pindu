/**
 * 记忆等级的展示规则（自适应复习，DECISIONS D20；与后端 services/srs.rs 一致）。
 * 等级 0 = 未学；1–5 对应复习间隔 1 / 3 / 7 / 14 / 30 天；≥ 4 为掌握。
 */

export const MEMORY_INTERVAL_DAYS = [1, 3, 7, 14, 30] as const;
export const MASTERED_BOX = 4;

/** 单词的学习状态（列表筛选与标签用） */
export type MemoryStage = 'new' | 'learning' | 'mastered';

export function memoryStage(box: number | null | undefined): MemoryStage {
  const b = box ?? 0;
  if (b <= 0) return 'new';
  return b >= MASTERED_BOX ? 'mastered' : 'learning';
}

export const MEMORY_STAGE_LABEL: Record<MemoryStage, string> = {
  new: '未学',
  learning: '学习中',
  mastered: '已掌握',
};

/** 等级说明，如“等级 2 · 隔 3 天复习” */
export function memoryBoxLabel(box: number | null | undefined): string {
  const b = box ?? 0;
  if (b <= 0) return '还没学';
  const days = MEMORY_INTERVAL_DAYS[Math.min(b, MEMORY_INTERVAL_DAYS.length) - 1];
  return `等级 ${b} · 隔 ${days} 天复习`;
}

/** 下次复习的相对说明：今天 / 已过期 N 天 / N 天后（today 为本地 YYYY-MM-DD） */
export function dueLabel(due: string | null | undefined, today: string): string {
  if (!due) return '—';
  const toDays = (d: string) => {
    const [y, m, day] = d.slice(0, 10).split('-').map(Number);
    return Date.UTC(y, m - 1, day) / 86_400_000;
  };
  const diff = Math.round(toDays(due) - toDays(today));
  if (diff === 0) return '今天';
  if (diff < 0) return `已到期 ${-diff} 天`;
  return diff === 1 ? '明天' : `${diff} 天后`;
}
