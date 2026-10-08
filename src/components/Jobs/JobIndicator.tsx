import React, { useState } from 'react';
import { Activity, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { setJobsSheetOpen, useJobs } from '@/hooks/useJobs';
import { instantMs } from '@/utils/datetime';
import type { NavigateFn } from '@/navigation';
import { isJobActive } from '@/types/job';
import { JobItem } from './JobItem';
import { useJobActions } from './useJobActions';

/** 浮层里最多显示的已结束任务 */
const RECENT_FINISHED = 5;

/**
 * 顶栏右侧的任务按钮（没有任务时不显示）：进行中转圈 + 数量；有新的失败时带红点（打开浮层后消失）。
 * 点开是任务浮层：进行中在上、最近结束的在下，底部「查看全部任务」打开任务面板。
 */
export const JobIndicator: React.FC<{ onNavigate: NavigateFn }> = ({ onNavigate }) => {
  const jobs = useJobs();
  const actions = useJobActions(onNavigate);
  const [seenAt, setSeenAt] = useState(() => Date.now());
  if (jobs.length === 0) return null;

  const active = jobs.filter(isJobActive);
  const finished = jobs.filter((j) => !isJobActive(j));
  const unseenFailure = finished.some((j) => j.status === 'failed' && instantMs(j.finishedAt) > seenAt);
  const label = active.length > 0 ? `${active.length} 个任务进行中` : '后台任务';

  return (
    <Popover onOpenChange={(open) => open && setSeenAt(Date.now())}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="relative h-8 gap-1.5 px-2" aria-label={label}>
              {active.length > 0 ? (
                <Loader2 className="size-4 animate-spin text-primary" />
              ) : finished.some((j) => j.status === 'succeeded') ? (
                <CheckCircle2 className="size-4 text-success" />
              ) : (
                <Activity className="size-4" />
              )}
              {active.length > 0 && <span className="text-xs tabular-nums">{active.length}</span>}
              {unseenFailure && <span className="absolute top-1 right-1 size-2 rounded-full bg-destructive" />}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-b px-3 py-2 text-sm font-medium">后台任务</div>
        <div className="max-h-96 overflow-y-auto p-1">
          {active.map((job) => (
            <JobItem key={job.id} job={job} {...actionProps(actions)} />
          ))}
          {active.length > 0 && finished.length > 0 && <div className="my-1 border-t" />}
          {finished.slice(0, RECENT_FINISHED).map((job) => (
            <JobItem key={job.id} job={job} {...actionProps(actions)} />
          ))}
        </div>
        <div className={cn('border-t p-1')}>
          <Button variant="ghost" size="sm" className="w-full justify-center" onClick={() => setJobsSheetOpen(true)}>
            查看全部任务
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export const actionProps = (actions: ReturnType<typeof useJobActions>) => ({
  onCancel: actions.cancel,
  onOpen: actions.open,
  onRemove: actions.remove,
});
