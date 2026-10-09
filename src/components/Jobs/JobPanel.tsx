import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useElapsed } from '@/hooks/useElapsed';
import { jobService } from '@/services/jobService';
import { formatDuration } from '@/utils/datetime';
import { isJobActive, type Job } from '@/types/job';
import { jobErrorText, jobPercent } from './JobItem';

/** 后台任务停止中的阶段（jobs.rs 请求停止后写入） */
export const STOPPING_STAGE = '正在停止…';

export interface JobPanelProps {
  /** 任务（刚提交时可能还没收到推送） */
  job: Job | undefined;
  /** 进行中的标题，写「AI 正在…」 */
  title: string;
  /** 进度数（如「3 / 20」）；默认 total > 0 时显示 current / total */
  count?: React.ReactNode;
  /** 副标题后面的补充（如预计剩余时间） */
  extra?: string;
  /** 面板上的操作（页面里用；弹窗把「停止」「在后台继续」放在底部操作栏，不传） */
  /** stop：true 用默认的停止任务；传函数时由调用方停止（如还要重置页面） */
  actions?: { stop?: boolean | (() => void); onBackground?: () => void };
  /** 面板下方的明细（逐项状态） */
  children?: React.ReactNode;
}

/**
 * 后台任务的进度面板（统一样式）：图标 + 标题（AI 正在… / 正在停止… / 已完成 / 没有完成）
 * → 副标题（排队中 / 当前阶段 · 已用时间）→ 进度条 → 明细。素材卡片上的小号版本是 JobProgress。
 */
export const JobPanel: React.FC<JobPanelProps> = ({ job, title, count, extra, actions, children }) => {
  const active = !job || isJobActive(job);
  const failed = job?.status === 'failed';
  const [stopRequested, setStopRequested] = useState(false);
  const stopping = active && (stopRequested || job?.stage === STOPPING_STAGE);
  const elapsed = useElapsed(job?.startedAt, active);
  const heading = stopping ? STOPPING_STAGE : !active ? (failed ? '没有完成' : job?.status === 'cancelled' ? '已停止' : '已完成') : title;
  const sub = !job || job.status === 'queued' ? '排队中' : stopping ? null : (job.stage ?? '准备中');
  const shownCount = count ?? (job && job.total > 0 ? `${job.current} / ${job.total}` : null);

  const stop = async () => {
    if (!job) return;
    setStopRequested(true);
    if (typeof actions?.stop === 'function') {
      actions.stop();
      return;
    }
    const r = await jobService.cancel(job.id);
    if (!r.success) setStopRequested(false);
  };

  return (
    <div className="space-y-3 rounded-lg border p-4" role="status">
      <div className="flex items-center gap-3">
        {active ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
        ) : failed ? (
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
        ) : (
          <CheckCircle2 className="size-4 shrink-0 text-success" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{heading}</div>
          {active && (
            <div className="truncate text-xs text-muted-foreground">
              {[sub, elapsed !== null && job?.startedAt ? `已用 ${formatDuration(elapsed * 1000)}` : null, extra].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        {shownCount != null && <div className="text-sm text-muted-foreground tabular-nums">{shownCount}</div>}
        {active && actions?.onBackground && (
          <Button variant="ghost" size="sm" onClick={actions.onBackground}>
            在后台继续
          </Button>
        )}
        {active && actions?.stop && (
          <Button variant="outline" size="sm" onClick={stop} disabled={stopping || !job}>
            停止
          </Button>
        )}
      </div>
      {active && <Progress value={job ? jobPercent(job) : 3} className="h-1.5 [&>[data-slot=progress-indicator]]:bg-brand" aria-label={`${title}进度`} />}
      {failed && job && <p className="text-xs text-destructive">{jobErrorText(job)}</p>}
      {children}
    </div>
  );
};
