import React from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { jobErrorText, jobPercent } from '@/components/Jobs';
import { instantMs } from '@/utils/datetime';
import type { Job } from '@/types/job';

export interface PlanningProgressProps {
  /** AI 排序任务（job-updated 推送；刚提交时可能还没有） */
  job: Job | undefined;
  /** 取消规划 */
  onCancel: () => void;
}

/**
 * AI 规划学习计划的进度（内联卡片）：当前阶段、已用时间；输出长度不可预知，进度条按已用时间渐近；可取消。
 */
export const PlanningProgress: React.FC<PlanningProgressProps> = ({ job, onCancel }) => {
  const done = job?.status === 'succeeded';
  const failed = job?.status === 'failed';
  const elapsed = job?.startedAt ? Math.round((Date.now() - instantMs(job.startedAt)) / 1000) : 0;
  const pct = job ? jobPercent(job) : 5;

  return (
    <div className="space-y-2.5 rounded-lg border p-3" role="status">
      <div className="flex items-center gap-2.5">
        {done ? (
          <CheckCircle2 className="size-4 shrink-0 text-success" />
        ) : failed ? (
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
        ) : (
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{done ? '排序完成' : failed ? '排序失败' : 'AI 正在排学习顺序'}</div>
          <div className="truncate text-xs text-muted-foreground">
            {job?.status === 'queued' ? '排队中，前面的 AI 任务完成后开始' : (job?.stage ?? '准备中…')}
            {job?.startedAt && ` · 已用 ${elapsed} 秒`}
          </div>
        </div>
        {!done && (
          <Button variant="ghost" size="sm" className="h-7" onClick={onCancel}>
            取消
          </Button>
        )}
      </div>
      <Progress value={pct} className="h-1 [&>[data-slot=progress-indicator]]:bg-brand" />
      {elapsed > 60 && !done && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="size-3.5" />
          单词较多时需要 1–3 分钟，请耐心等待。
        </p>
      )}
      {failed && job && <p className="text-xs text-destructive">{jobErrorText(job)}</p>}
    </div>
  );
};
