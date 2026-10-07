import React from 'react';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { UnifiedStudyPlanStatus } from '@/types';

export interface PlanProgressBarProps {
  /** 学习进度 %（已掌握 / 总单词） */
  learnProgress: number;
  /** 时间进度 %（画成竖线刻度） */
  timeProgress: number;
  /** 计划状态：只有进行中才提示快慢 */
  status: UnifiedStudyPlanStatus;
  /** 进度条高度等 */
  className?: string;
  /** 左下角文字（如正确率），不传则显示“时间已过 N%” */
  caption?: React.ReactNode;
}

/** 学习进度相对时间进度：进行中且已开始时，差距超过 10% 才提示 */
export function paceOf(learn: number, time: number, status: UnifiedStudyPlanStatus): { text: string; className: string } | null {
  if (status !== 'Active' || time <= 0) return null;
  const diff = learn - time;
  if (diff <= -10) return { text: `落后计划 ${Math.round(-diff)}%`, className: 'text-warning' };
  if (diff >= 10) return { text: `领先计划 ${Math.round(diff)}%`, className: 'text-success' };
  return { text: '进度正常', className: 'text-muted-foreground' };
}

/** 计划进度条：学习进度 + 时间进度刻度 + 快慢提示（计划卡与计划详情共用） */
export const PlanProgressBar: React.FC<PlanProgressBarProps> = ({ learnProgress, timeProgress, status, className, caption }) => {
  const pace = paceOf(learnProgress, timeProgress, status);
  return (
    <div className="space-y-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative">
            <Progress value={learnProgress} className={cn('h-1.5 [&>[data-slot=progress-indicator]]:bg-brand', className)} aria-label="学习进度" />
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
          学习进度 {learnProgress.toFixed(1)}% · 时间进度 {timeProgress.toFixed(1)}%（竖线）
        </TooltipContent>
      </Tooltip>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{caption ?? `时间已过 ${timeProgress.toFixed(0)}%`}</span>
        {pace && <span className={pace.className}>{pace.text}</span>}
      </div>
    </div>
  );
};
