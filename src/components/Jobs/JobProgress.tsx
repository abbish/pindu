import React from 'react';
import { Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { isJobActive, type Job } from '@/types/job';
import { jobPercent } from './JobItem';

/**
 * 素材卡片上的后台任务进度（视频导入 / 切分、单词分析、出题、写短文……统一样式）：
 * 转圈 + 当前阶段（排队时「排队中」）+ 细进度条；同一素材还有别的任务在排队时说一声（`waiting`）。
 */
export const JobProgress: React.FC<{ job: Job; fallback?: string; waiting?: number }> = ({ job, fallback, waiting = 0 }) => (
  <div className="space-y-1">
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="size-3 shrink-0 animate-spin" />
      <span className="truncate">
        {job.status === 'queued' ? '排队中' : (job.stage ?? fallback ?? job.title)}
        {waiting > 0 && ` · 还有 ${waiting} 项排队`}
      </span>
    </div>
    <Progress value={jobPercent(job)} className="h-1" aria-label={`${job.title} 进度`} />
  </div>
);

/**
 * 同一素材的几个进行中任务里该显示哪个：正在运行的优先（列表新的在前，排队的往往是后提交的，
 * 先显示它会让正在跑的任务看起来卡住了），都在排队时显示最早提交的
 */
export function pickActiveJob(jobs: Job[]): Job | undefined {
  const active = jobs.filter(isJobActive);
  return active.find((j) => j.status === 'running') ?? active[active.length - 1];
}

/** 进行中的、指向某个素材的任务：kinds 之一，且 link.params[key] === id（正在运行的优先） */
export function activeJobFor(jobs: Job[], kinds: string[], key: string, id: number): Job | undefined {
  return pickActiveJob(jobs.filter((j) => kinds.includes(j.kind) && (j.link?.params as Record<string, unknown> | null | undefined)?.[key] === id));
}
