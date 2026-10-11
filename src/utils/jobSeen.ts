import { instantMs } from './datetime.ts';
import type { Job } from '../types/job.ts';

/** 任务页的键：在任务页看过的任务，各模块上也算看过 */
export const JOBS_PAGE = 'jobs';

/**
 * 已结束的任务是否还没看过：结束时刻晚于它所属模块与任务页两处最近一次看过的时刻（任何一处看过就算看过）。
 * seen：模块键 / 任务页 → 看过的时刻（ms）；since：两处都没看过时的起点（打开应用的时刻，之前结束的不算）。
 */
export function isJobUnseen(job: Pick<Job, 'status' | 'module' | 'finishedAt'>, seen: ReadonlyMap<string, number>, since: number): boolean {
  if (job.status === 'queued' || job.status === 'running' || !job.finishedAt) return false;
  const at = Math.max(since, seen.get(JOBS_PAGE) ?? 0, job.module ? (seen.get(job.module) ?? 0) : 0);
  return instantMs(job.finishedAt) > at;
}

/** 任务页默认打开的页签：有进行中的看进行中，否则看最近结束的那个任务所在的页签 */
export function defaultJobsTab(jobs: Pick<Job, 'status' | 'finishedAt'>[]): 'active' | 'done' | 'failed' {
  if (jobs.length === 0 || jobs.some((j) => j.status === 'queued' || j.status === 'running')) return 'active';
  const latest = jobs.reduce((a, b) => (instantMs(b.finishedAt ?? '') > instantMs(a.finishedAt ?? '') ? b : a));
  return latest.status === 'failed' ? 'failed' : 'done';
}
