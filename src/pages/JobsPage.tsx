import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { forgetJobs, useJobs } from '@/hooks/useJobs';
import { jobService } from '@/services/jobService';
import type { JobsTab, NavigateFn } from '@/navigation';
import { isJobActive, type Job } from '@/types/job';
import { defaultJobsTab } from '@/utils/jobSeen';
import { JobItem } from '@/components/Jobs/JobItem';
import { actionProps, useJobActions } from '@/components/Jobs/useJobActions';

type Filter = JobsTab;

const FILTERS: { value: Filter; label: string; match: (job: Job) => boolean; empty: string }[] = [
  { value: 'active', label: '进行中', match: isJobActive, empty: '没有正在进行的任务' },
  { value: 'done', label: '已完成', match: (j) => j.status === 'succeeded' || j.status === 'cancelled', empty: '还没有完成的任务' },
  { value: 'failed', label: '失败', match: (j) => j.status === 'failed', empty: '没有失败的任务' },
];

/** 后台任务：进行中与这次打开应用以来结束的任务（侧边栏「后台任务」、macOS「窗口 → 后台任务」） */
/** tab：要打开的页签（失败提示的「查看」打开「失败」）；没给时有进行中的看进行中，否则看最近结束的任务所在的页签 */
export const JobsPage: React.FC<{ tab?: JobsTab; onNavigate: NavigateFn }> = ({ tab, onNavigate }) => {
  const jobs = useJobs();
  const actions = useJobActions(onNavigate);
  const [filter, setFilter] = useState<Filter>(() => tab ?? defaultJobsTab(jobs));
  const current = FILTERS.find((f) => f.value === filter)!;
  const shown = jobs.filter(current.match);
  const finishedIds = jobs.filter((j) => !isJobActive(j)).map((j) => j.id);

  const clearFinished = async () => {
    forgetJobs(finishedIds);
    await jobService.clearFinished();
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-7">
      <PageHeader
        title="后台任务"
        actions={
          <Button variant="outline" onClick={clearFinished} disabled={finishedIds.length === 0}>
            清除已结束
          </Button>
        }
      />
      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList>
          {FILTERS.map((f) => (
            <TabsTrigger key={f.value} value={f.value}>
              {f.label}
              <span className="ml-1 text-xs text-muted-foreground tabular-nums">{jobs.filter(f.match).length}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="rounded-xl border p-2">
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{current.empty}</p>
        ) : (
          shown.map((job) => <JobItem key={job.id} job={job} {...actionProps(actions)} />)
        )}
      </div>
    </div>
  );
};
