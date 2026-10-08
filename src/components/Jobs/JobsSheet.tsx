import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { forgetJobs, setJobsSheetOpen, useJobs, useJobsSheetOpen } from '@/hooks/useJobs';
import { jobService } from '@/services/jobService';
import type { NavigateFn } from '@/navigation';
import { isJobActive, type Job } from '@/types/job';
import { JobItem } from './JobItem';
import { actionProps } from './JobIndicator';
import { useJobActions } from './useJobActions';

type Filter = 'active' | 'done' | 'failed';

const FILTERS: { value: Filter; label: string; match: (job: Job) => boolean; empty: string }[] = [
  { value: 'active', label: '进行中', match: isJobActive, empty: '没有正在进行的任务' },
  { value: 'done', label: '已完成', match: (j) => j.status === 'succeeded' || j.status === 'cancelled', empty: '还没有完成的任务' },
  { value: 'failed', label: '失败', match: (j) => j.status === 'failed', empty: '没有失败的任务' },
];

/** 全部任务面板（右侧 Sheet）：入口为顶栏浮层底部、macOS「窗口 → 后台任务」 */
export const JobsSheet: React.FC<{ onNavigate: NavigateFn }> = ({ onNavigate }) => {
  const open = useJobsSheetOpen();
  const jobs = useJobs();
  const actions = useJobActions(onNavigate);
  const [filter, setFilter] = useState<Filter>('active');
  const current = FILTERS.find((f) => f.value === filter)!;
  const shown = jobs.filter(current.match);
  const finishedIds = jobs.filter((j) => !isJobActive(j)).map((j) => j.id);

  const clearFinished = async () => {
    forgetJobs(finishedIds);
    await jobService.clearFinished();
  };

  return (
    <Sheet open={open} onOpenChange={setJobsSheetOpen}>
      <SheetContent className="flex w-[420px] flex-col gap-0 sm:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>后台任务</SheetTitle>
          <SheetDescription className="sr-only">正在进行和已结束的任务</SheetDescription>
        </SheetHeader>
        <div className="flex items-center justify-between gap-2 px-4">
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
          <Button variant="ghost" size="sm" onClick={clearFinished} disabled={finishedIds.length === 0}>
            清除已结束
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {shown.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{current.empty}</p>
          ) : (
            shown.map((job) => <JobItem key={job.id} job={job} {...actionProps(actions)} />)
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
