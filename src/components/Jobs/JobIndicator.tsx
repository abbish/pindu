import React, { useState } from 'react';
import { Activity, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
 * 侧边栏底部的任务入口：有进行中的任务、或有还没看过的结果时显示，否则隐藏。
 * 进行中转圈 + 数量；有新的失败时带红点（打开浮层后消失）。
 * 点开是任务浮层：进行中在上、最近结束的在下，底部「查看全部任务」打开任务面板。
 */
export const JobIndicator: React.FC<{ onNavigate: NavigateFn }> = ({ onNavigate }) => {
  const jobs = useJobs();
  const actions = useJobActions(onNavigate);
  const [seenAt, setSeenAt] = useState(() => Date.now());
  const [open, setOpen] = useState(false);

  const active = jobs.filter(isJobActive);
  const finished = jobs.filter((j) => !isJobActive(j));
  const unseen = finished.filter((j) => instantMs(j.finishedAt) > seenAt);
  if (active.length === 0 && unseen.length === 0 && !open) return null;

  const unseenFailure = unseen.some((j) => j.status === 'failed');
  const label = active.length > 0 ? `${active.length} 个任务进行中` : '任务已完成';

  return (
    <SidebarMenuItem>
      <Popover
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setSeenAt(Date.now());
        }}
      >
        <PopoverTrigger asChild>
          <SidebarMenuButton tooltip={label} className="relative">
            {active.length > 0 ? (
              <Loader2 className="animate-spin text-primary" />
            ) : unseen.some((j) => j.status === 'succeeded') ? (
              <CheckCircle2 className="text-success" />
            ) : (
              <Activity />
            )}
            <span>{label}</span>
            {unseenFailure && <span className="absolute top-1.5 left-5 size-2 rounded-full bg-destructive" />}
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent side="right" align="end" className="w-96 p-0">
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
    </SidebarMenuItem>
  );
};

export const actionProps = (actions: ReturnType<typeof useJobActions>) => ({
  onCancel: actions.cancel,
  onOpen: actions.open,
  onRemove: actions.remove,
});
