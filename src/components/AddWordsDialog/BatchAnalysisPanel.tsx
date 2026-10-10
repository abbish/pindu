import React from 'react';
import { Check, Clock, Loader2, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { JobPanel } from '@/components/Jobs';
import { estimateRemainingSeconds } from '@/services/wordAnalysisService';
import { formatDuration, instantMs } from '@/utils/datetime';
import type { Job } from '@/types/job';
import type { WordAnalysisDetail } from '@/types/word-analysis';

type WordState = 'completed' | 'analyzing' | 'pending' | 'failed';

const STATE_META: Record<WordState, { label: string; dot: string; chip: string; icon: React.ComponentType<{ className?: string }> }> = {
  completed: { label: '已完成', dot: 'bg-success', chip: 'border-success/30 text-foreground', icon: Check },
  analyzing: { label: '分析中', dot: 'bg-primary', chip: 'border-primary/40 text-foreground', icon: Loader2 },
  pending: { label: '等待中', dot: 'bg-muted-foreground/40', chip: 'border-border text-muted-foreground', icon: Clock },
  failed: { label: '失败', dot: 'bg-destructive', chip: 'border-destructive/40 text-destructive', icon: X },
};
const STATE_ORDER: WordState[] = ['completed', 'analyzing', 'pending', 'failed'];
const ICON_CLASS: Record<WordState, string> = {
  completed: 'text-success',
  analyzing: 'animate-spin text-primary',
  pending: 'text-muted-foreground/60',
  failed: 'text-destructive',
};

export interface BatchAnalysisPanelProps {
  /** 「分析并加入词汇本」任务（逐词状态在 job.detail） */
  job: Job | undefined;
  /** 进度面板上的操作（如「停止」）；弹窗里由弹窗底部提供，不传 */
  actions?: React.ComponentProps<typeof JobPanel>['actions'];
}

/**
 * 批量拼读分析进度（只负责展示；停止 / 在后台继续在弹窗底部操作栏）：
 * 统一的任务进度面板（已分析数、预计剩余）→ 状态图例（计数）→ 单词状态（悬停看失败原因）。
 */
export const BatchAnalysisPanel: React.FC<BatchAnalysisPanelProps> = ({ job, actions }) => {
  const words = (job?.detail as WordAnalysisDetail | null)?.words ?? [];
  const counts = STATE_ORDER.reduce<Record<WordState, number>>(
    (acc, s) => ({ ...acc, [s]: words.filter((w) => w.status === s).length }),
    { completed: 0, analyzing: 0, pending: 0, failed: 0 }
  );
  const total = words.length;
  const done = counts.completed + counts.failed;
  const elapsed = job?.startedAt ? (Date.now() - instantMs(job.startedAt)) / 1000 : 0;
  const remaining = estimateRemainingSeconds(total, done, elapsed);

  return (
    <div className="flex flex-col gap-6 py-2">
      <JobPanel
        job={job}
        title="AI 正在分析单词"
        count={total > 0 ? `${done} / ${total}` : undefined}
        extra={remaining !== null ? `预计还需 ${formatDuration(remaining * 1000)}` : undefined}
        actions={actions}
      >
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {STATE_ORDER.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', STATE_META[s].dot)} />
              {STATE_META[s].label}
              <span className="tabular-nums text-foreground">{counts[s]}</span>
            </span>
          ))}
        </div>
      </JobPanel>

      {words.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {words.map((w) => {
            const state = w.status as WordState;
            const Icon = STATE_META[state].icon;
            return (
              <Tooltip key={w.word}>
                <TooltipTrigger asChild>
                  <span className={cn('inline-flex h-7 items-center gap-1.5 rounded-md border bg-background px-2 text-sm', STATE_META[state].chip)}>
                    <Icon className={cn('size-3.5', ICON_CLASS[state])} />
                    {w.word}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{w.error ? `${w.word}：${w.error}` : `${w.word}：${STATE_META[state].label}`}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
};
