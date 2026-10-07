import React from 'react';
import { Check, Clock, Loader2, X } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { estimateRemainingTime } from '@/services/wordAnalysisService';
import { formatDuration } from '@/utils/datetime';
import type { BatchAnalysisProgress } from '@/types/word-analysis';

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
  /** 轮询得到的进度（约 500ms 一次） */
  progress: BatchAnalysisProgress | null;
  /** 已请求停止：标题改为“正在停止” */
  stopping?: boolean;
}

/**
 * 批量拼读分析进度（只负责展示；停止 / 取消在弹窗底部操作栏）：
 * 标题与进度条 → 状态图例（计数）→ 单词状态（悬停看失败原因）。
 */
export const BatchAnalysisPanel: React.FC<BatchAnalysisPanelProps> = ({ progress, stopping = false }) => {
  const words = progress?.wordStatuses ?? [];
  const analysis = progress?.analysisProgress;
  const counts = STATE_ORDER.reduce<Record<WordState, number>>(
    (acc, s) => ({ ...acc, [s]: words.filter((w) => w.status === s).length }),
    { completed: 0, analyzing: 0, pending: 0, failed: 0 }
  );
  const total = analysis?.totalWords || words.length;
  const done = counts.completed + counts.failed;
  const percent = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const elapsed = analysis?.elapsedSeconds ?? 0;
  const remaining = progress ? estimateRemainingTime(progress) : null;
  const starting = !progress || words.length === 0;

  return (
    <div className="flex flex-col gap-6 py-2">
      <div className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 font-medium">
              <Loader2 className="size-4 animate-spin text-primary" />
              {stopping ? '正在停止，等进行中的单词完成…' : starting ? '正在准备分析…' : '正在分析拼读、音标和例句'}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {starting
                ? '马上开始'
                : `已用 ${formatDuration(elapsed * 1000)}${remaining !== null && !stopping ? ` · 预计还需 ${formatDuration(remaining * 1000)}` : ''}`}
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums">
              {done}
              <span className="text-base font-normal text-muted-foreground"> / {total || '–'}</span>
            </div>
          </div>
        </div>
        <Progress value={percent} className="h-1.5 [&>[data-slot=progress-indicator]]:bg-brand" aria-label={`已分析 ${Math.round(percent)}%`} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {STATE_ORDER.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', STATE_META[s].dot)} />
              {STATE_META[s].label}
              <span className="tabular-nums text-foreground">{counts[s]}</span>
            </span>
          ))}
        </div>
      </div>

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
