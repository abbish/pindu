import React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { UnifiedStudyPlanStatus } from '@/types';

export interface PlanProgressBarProps {
  /** 学习进度 %（已学 = 练过一次的单词 / 总单词；只练短文时为完成篇数比例） */
  learnProgress: number;
  /** 已掌握 %（隔 7 天还能写对的单词 / 总单词），画在已学之上的深色段；只练短文时不传 */
  masteredProgress?: number;
  /** 时间进度 %（画成竖线刻度） */
  timeProgress: number;
  /** 没练的日子（日期已过、任务没完成）：进行中的计划据此提示落后 */
  overdueDays?: number;
  /** 计划状态：只有进行中才提示快慢 */
  status: UnifiedStudyPlanStatus;
  /** 进度条高度等 */
  className?: string;
  /** 左下角文字（如一次答对率），不传则显示“时间已过 N%” */
  caption?: React.ReactNode;
}

/** 进行中的计划：有没练的日子就提示落后几天（巩固期没有新词，按时间比例比较会误报领先） */
export function paceOf(overdueDays: number | undefined, status: UnifiedStudyPlanStatus): { text: string; className: string } | null {
  if (status !== 'Active' || overdueDays === undefined) return null;
  if (overdueDays > 0) return { text: `落后 ${overdueDays} 天`, className: 'text-warning' };
  return { text: '进度正常', className: 'text-muted-foreground' };
}

const clamp = (v: number) => Math.min(100, Math.max(0, v));

/** 计划进度条：已学（浅）+ 已掌握（深）两段、时间进度刻度、快慢提示（计划卡与计划详情共用） */
export const PlanProgressBar: React.FC<PlanProgressBarProps> = ({ learnProgress, masteredProgress, timeProgress, overdueDays, status, className, caption }) => {
  const pace = paceOf(overdueDays, status);
  const twoSegments = masteredProgress !== undefined;
  return (
    <div className="space-y-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative">
            <div
              className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
              role="progressbar"
              aria-label="学习进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(learnProgress)}
            >
              <div className={cn('absolute inset-y-0 left-0 rounded-full', twoSegments ? 'bg-brand/40' : 'bg-brand')} style={{ width: `${clamp(learnProgress)}%` }} />
              {twoSegments && <div className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${clamp(masteredProgress)}%` }} />}
            </div>
            {timeProgress > 0 && timeProgress < 100 && (
              <span
                className="absolute -top-1 h-[calc(100%+0.5rem)] w-0.5 rounded-full bg-foreground/60"
                style={{ left: `calc(${timeProgress}% - 1px)` }}
                aria-hidden="true"
              />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          {twoSegments ? `已学 ${learnProgress.toFixed(0)}% · 已掌握 ${masteredProgress.toFixed(0)}%` : `完成 ${learnProgress.toFixed(0)}%`} · 时间已过 {timeProgress.toFixed(0)}%（竖线）
        </TooltipContent>
      </Tooltip>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{caption ?? `时间已过 ${timeProgress.toFixed(0)}%`}</span>
        {pace && <span className={pace.className}>{pace.text}</span>}
      </div>
    </div>
  );
};
