import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { buildHeatmap, type HeatmapActivity, type HeatmapCell } from '@/utils/learningHeatmap';
import { parseLocalDate } from '@/utils/datetime';
import { useToday } from '@/hooks/useToday';

export interface LearningHeatmapProps {
  /** 每日学习量（只含有学习的日期） */
  activity: HeatmapActivity[];
  /** 加载中显示骨架 */
  loading?: boolean;
}

/** 由浅到深：0 无学习，1–4 按区间最大值四等分 */
const LEVEL_CLASS: Record<HeatmapCell['level'], string> = {
  0: 'bg-muted',
  1: 'bg-brand/25',
  2: 'bg-brand/50',
  3: 'bg-brand/75',
  4: 'bg-brand',
};

const CELL = 13;
const GAP = 3;
const LABEL_WIDTH = 20;
const MIN_WEEKS = 12;
const MAX_WEEKS = 53;
const WEEKDAY_LABELS = ['一', '', '三', '', '五', '', ''];

function cellTitle(cell: HeatmapCell): string {
  const [, m, d] = cell.date.split('-').map(Number);
  const day = `${m}月${d}日${cell.isToday ? '（今天）' : ''}`;
  if (cell.practiced === 0) return `${day} · 没有学习`;
  return `${day} · 练习 ${cell.practiced} 个单词${cell.mastered > 0 ? ` · 学会 ${cell.mastered} 个` : ''}`;
}

/**
 * 学习热力图（类似 GitHub 贡献图）：每格一天，颜色越深当天练习的单词越多。
 * 周数随卡片宽度自适应（12–53 周），最后一列是本周。
 */
export const LearningHeatmap: React.FC<LearningHeatmapProps> = ({ activity, loading }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [weekCount, setWeekCount] = useState(26);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const fit = Math.floor((el.clientWidth - LABEL_WIDTH + GAP) / (CELL + GAP));
      setWeekCount(Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, fit)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const today = useToday();
  // today 变化（跨零点）时重建网格
  const grid = useMemo(
    () => buildHeatmap(activity, parseLocalDate(today) ?? new Date(), weekCount),
    [activity, weekCount, today]
  );

  return (
    <Card className="gap-3 px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">学习热力图</h2>
        {!loading && (
          <span className="text-xs text-muted-foreground">
            近 {weekCount} 周学习 {grid.activeDays} 天 · 共练习 {grid.totalPracticed} 个单词
          </span>
        )}
      </div>

      <div ref={containerRef} className="w-full">
        {loading ? (
          <Skeleton className="w-full" style={{ height: 7 * CELL + 6 * GAP + 18 }} />
        ) : (
          <div className="flex flex-col gap-1">
            {/* 月份标签 */}
            <div className="relative h-3.5 text-[11px] leading-none text-muted-foreground" style={{ marginLeft: LABEL_WIDTH }}>
              {grid.monthLabels.map(({ column, label }) => (
                <span key={`${column}-${label}`} className="absolute top-0" style={{ left: column * (CELL + GAP) }}>
                  {label}
                </span>
              ))}
            </div>
            <div className="flex" style={{ gap: GAP }}>
              {/* 星期标签 */}
              <div className="flex flex-col text-[10px] leading-none text-muted-foreground" style={{ width: LABEL_WIDTH - GAP, gap: GAP }}>
                {WEEKDAY_LABELS.map((label, i) => (
                  <span key={i} className="flex items-center" style={{ height: CELL }}>
                    {label}
                  </span>
                ))}
              </div>
              {grid.weeks.map((week) => (
                <div key={week[0].date} className="flex flex-col" style={{ gap: GAP }}>
                  {week.map((cell) =>
                    cell.future ? (
                      <span key={cell.date} style={{ width: CELL, height: CELL }} />
                    ) : (
                      <Tooltip key={cell.date}>
                        <TooltipTrigger asChild>
                          <span
                            aria-label={cellTitle(cell)}
                            className={cn(
                              'rounded-[3px]',
                              LEVEL_CLASS[cell.level],
                              cell.isToday && 'ring-1 ring-foreground/50 ring-offset-1 ring-offset-card'
                            )}
                            style={{ width: CELL, height: CELL }}
                          />
                        </TooltipTrigger>
                        <TooltipContent>{cellTitle(cell)}</TooltipContent>
                      </Tooltip>
                    )
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
        <span className="mr-1">少</span>
        {([0, 1, 2, 3, 4] as const).map((level) => (
          <span key={level} className={cn('rounded-[3px]', LEVEL_CLASS[level])} style={{ width: CELL - 2, height: CELL - 2 }} />
        ))}
        <span className="ml-1">多</span>
      </div>
    </Card>
  );
};
