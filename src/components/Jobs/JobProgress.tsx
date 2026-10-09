import React from 'react';
import { Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { isJobActive, type Job } from '@/types/job';
import { jobPercent } from './JobItem';

/**
 * 素材卡片上的后台任务进度（视频导入 / 切分、单词分析、出题、写短文……统一样式）：
 * 转圈 + 当前阶段（排队时「排队中」）+ 细进度条。
 */
export const JobProgress: React.FC<{ job: Job; fallback?: string }> = ({ job, fallback }) => (
  <div className="space-y-1">
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="size-3 shrink-0 animate-spin" />
      <span className="truncate">{job.status === 'queued' ? '排队中' : (job.stage ?? fallback ?? job.title)}</span>
    </div>
    <Progress value={jobPercent(job)} className="h-1" aria-label={`${job.title} 进度`} />
  </div>
);

/** 进行中的、指向某个素材的任务：kinds 之一，且 link.params[key] === id */
export function activeJobFor(jobs: Job[], kinds: string[], key: string, id: number): Job | undefined {
  return jobs.find((j) => isJobActive(j) && kinds.includes(j.kind) && (j.link?.params as Record<string, unknown> | null | undefined)?.[key] === id);
}
