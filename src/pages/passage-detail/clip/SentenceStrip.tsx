import React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** 一句练得怎样：好 / 还差一点 / 不行 / 做过（没有好坏之分）/ 还没练 */
export type StripStatus = 'good' | 'close' | 'retry' | 'done' | null;

const STATUS_STYLE: Record<Exclude<StripStatus, null>, string> = {
  good: 'bg-success',
  close: 'bg-warning',
  retry: 'bg-destructive',
  done: 'bg-primary/60',
};

export interface SentenceStripProps {
  /** 要练的句子（句子序号）与各自的结果 */
  items: { index: number; status: StripStatus; label?: string }[];
  current: number;
  onPick: (index: number) => void;
}

/** 练习进度条：每句一小段，颜色是练的结果，还没练的当前句深一点；点哪段去哪句 */
export const SentenceStrip: React.FC<SentenceStripProps> = ({ items, current, onPick }) => (
  // 句子很多时每段可以缩到很窄，整条不超出所在的位置
  <ol className="flex min-w-0 items-center gap-0.5 overflow-hidden" aria-label="练习进度">
    {items.map(({ index, status, label }) => (
      <li key={index} className="flex min-w-0 flex-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`第 ${index + 1} 句`}
              aria-current={index === current ? 'true' : undefined}
              onClick={() => onPick(index)}
              className={cn('h-1.5 min-w-px flex-1 rounded-full transition-colors hover:opacity-80', status ? STATUS_STYLE[status] : 'bg-muted-foreground/15', index === current && !status && 'bg-foreground/50')}
            />
          </TooltipTrigger>
          <TooltipContent>
            第 {index + 1} 句{label ? `：${label}` : ''}
          </TooltipContent>
        </Tooltip>
      </li>
    ))}
  </ol>
);
