import React from 'react';
import { Ban, CheckCircle2, Clock, Loader2, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { toUserMessage, type AppErrorCode } from '@/api/errors';
import { formatDuration, formatRelative, instantMs } from '@/utils/datetime';
import type { Job } from '@/types/job';

const STATUS_META: Record<Job['status'], { label: string; icon: React.ComponentType<{ className?: string }>; className: string }> = {
  queued: { label: '排队中', icon: Clock, className: 'text-muted-foreground' },
  running: { label: '进行中', icon: Loader2, className: 'animate-spin text-primary' },
  succeeded: { label: '已完成', icon: CheckCircle2, className: 'text-success' },
  failed: { label: '失败', icon: XCircle, className: 'text-destructive' },
  cancelled: { label: '已停止', icon: Ban, className: 'text-muted-foreground' },
};

/** 失败原因（用户能看懂的一句话） */
export function jobErrorText(job: Job): string {
  if (!job.error) return '请再试一次';
  return toUserMessage(job.error.message, job.error.code as AppErrorCode);
}

/** 进度百分比；不确定时按已用时间给一个渐近值（不到 100） */
export function jobPercent(job: Job, now = Date.now()): number {
  if (job.status === 'succeeded') return 100;
  if (job.total > 0) return Math.min(100, (job.current / job.total) * 100);
  const elapsed = job.startedAt ? (now - instantMs(job.startedAt)) / 1000 : 0;
  return Math.min(90, 8 + elapsed * 1.2);
}

export interface JobItemProps {
  job: Job;
  onCancel: (job: Job) => void;
  onOpen: (job: Job) => void;
  onRemove: (job: Job) => void;
}

/** 任务列表的一行：状态、标题、阶段 / 原因、进度条、操作（取消 / 打开 / 移除） */
export const JobItem: React.FC<JobItemProps> = ({ job, onCancel, onOpen, onRemove }) => {
  const meta = STATUS_META[job.status];
  const Icon = meta.icon;
  const active = job.status === 'queued' || job.status === 'running';
  const elapsed = job.startedAt ? (job.finishedAt ? instantMs(job.finishedAt) : Date.now()) - instantMs(job.startedAt) : 0;
  const secondary =
    job.status === 'failed'
      ? jobErrorText(job)
      : active
        ? [job.stage ?? meta.label, job.total > 0 ? `${job.current}/${job.total}` : null, job.startedAt ? `已用 ${formatDuration(elapsed)}` : null]
            .filter(Boolean)
            .join(' · ')
        : `${meta.label}${job.finishedAt ? ` · ${formatRelative(job.finishedAt)}` : ''}`;

  return (
    <div className="group flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-muted/50">
      <Icon className={cn('mt-0.5 size-4 shrink-0', meta.className)} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="truncate text-sm font-medium" title={job.title}>
          {job.title}
        </div>
        <div className={cn('line-clamp-2 text-xs', job.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>{secondary}</div>
        {active && <Progress value={jobPercent(job)} className="h-1" aria-label={`${job.title} 进度`} />}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {active ? (
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onCancel(job)} disabled={job.stage === '正在停止…'}>
            停止
          </Button>
        ) : (
          <>
            {job.link && job.status !== 'failed' && (
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onOpen(job)}>
                打开
              </Button>
            )}
            <Button variant="ghost" size="icon" className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => onRemove(job)} aria-label="从列表移除">
              <X className="size-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
