import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StepperProps {
  /** 步骤名称 */
  steps: string[];
  /** 当前步骤（从 0 开始） */
  current: number;
}

/** 向导步骤条：已完成打勾、当前高亮、未开始置灰（创建单词本 / 创建计划等多步流程共用） */
export const Stepper: React.FC<StepperProps> = ({ steps, current }) => (
  <ol className="flex items-center gap-2" aria-label="步骤">
    {steps.map((label, i) => {
      const done = i < current;
      const active = i === current;
      return (
        <React.Fragment key={label}>
          {i > 0 && <li aria-hidden="true" className={cn('h-px w-8 flex-none', done || active ? 'bg-primary/60' : 'bg-border')} />}
          <li className="flex items-center gap-1.5" aria-current={active ? 'step' : undefined}>
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums',
                done && 'border-transparent bg-primary/15 text-primary',
                active && 'border-transparent bg-primary text-primary-foreground',
                !done && !active && 'text-muted-foreground'
              )}
            >
              {done ? <Check className="size-3" /> : i + 1}
            </span>
            <span className={cn('text-sm', active ? 'font-medium text-foreground' : 'text-muted-foreground')}>{label}</span>
          </li>
        </React.Fragment>
      );
    })}
  </ol>
);
