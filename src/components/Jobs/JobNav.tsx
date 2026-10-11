import React, { useState } from 'react';
import { ListTodo } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarMenuAction, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { markJobsSeen, useJobs, useJobsSeenAt } from '@/hooks/useJobs';
import { instantMs } from '@/utils/datetime';
import type { NavigateFn } from '@/navigation';
import { isJobActive, type Job } from '@/types/job';
import { JobItem } from './JobItem';
import { actionProps, useJobActions } from './useJobActions';

/** 模块浮层里最多显示的已结束任务 */
const RECENT_FINISHED = 5;

const finishedAfter = (job: Job, at: number) => !isJobActive(job) && job.finishedAt != null && instantMs(job.finishedAt) > at;

/** 任务浮层的内容：进行中在上、最近结束的在下，底部「查看全部任务」进入任务页 */
const JobsPopoverBody: React.FC<{ title: string; jobs: Job[]; onNavigate: NavigateFn; onClose: () => void }> = ({ title, jobs, onNavigate, onClose }) => {
  const actions = useJobActions(onNavigate);
  const active = jobs.filter(isJobActive);
  const finished = jobs.filter((j) => !isJobActive(j));
  const props = {
    ...actionProps(actions),
    onOpen: (job: Job) => {
      onClose();
      actions.open(job);
    },
  };
  return (
    <>
      <div className="border-b px-3 py-2 text-sm font-medium">{title}</div>
      <div className="max-h-96 overflow-y-auto p-1">
        {active.map((job) => (
          <JobItem key={job.id} job={job} {...props} />
        ))}
        {active.length > 0 && finished.length > 0 && <div className="my-1 border-t" />}
        {finished.slice(0, RECENT_FINISHED).map((job) => (
          <JobItem key={job.id} job={job} {...props} />
        ))}
        {jobs.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">没有任务</p>}
      </div>
      <div className="border-t p-1">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center"
          onClick={() => {
            onClose();
            onNavigate('jobs');
          }}
        >
          查看全部任务
        </Button>
      </div>
    </>
  );
};

/**
 * 侧边栏模块（词汇本、短文库、视频库、计划）右侧的任务标记：
 * 有进行中的任务时显示数量并呼吸；结束了还没看过时是一个小点（绿色完成、红色失败），点开浮层或进入这个模块后消失。
 * 点开是这个模块的任务浮层，底部「查看全部任务」进入任务页。侧栏收起成图标时只在图标角上显示小点。
 */
export const ModuleJobBadge: React.FC<{ module: string; label: string; current: boolean; onNavigate: NavigateFn }> = ({ module, label, current, onNavigate }) => {
  const jobs = useJobs().filter((j) => j.module === module);
  const seenAt = useJobsSeenAt(module);
  const [open, setOpen] = useState(false);

  const active = jobs.filter(isJobActive);
  const finished = jobs.filter((j) => !isJobActive(j));
  // 正在看这个模块时，刚结束的任务已经在页面上看到了
  const unseen = current ? [] : finished.filter((j) => finishedAfter(j, seenAt));
  if (active.length === 0 && unseen.length === 0 && !open) return null;

  const failed = unseen.some((j) => j.status === 'failed');
  const title = active.length > 0 ? `${active.length} 个任务进行中` : failed ? '有任务没有完成' : '任务已完成';
  const dotColor = failed ? 'bg-destructive' : 'bg-success';

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) markJobsSeen(module);
  };

  return (
    <>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1.5 left-5 hidden size-2 rounded-full group-data-[collapsible=icon]:block',
          active.length > 0 ? 'bg-primary motion-safe:animate-pulse' : dotColor
        )}
      />
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <SidebarMenuAction aria-label={`${label}：${title}`} title={title} className="aspect-auto w-auto min-w-5 px-0.5">
            {active.length > 0 ? (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[11px] leading-none font-medium text-primary-foreground tabular-nums motion-safe:animate-pulse">
                {active.length}
              </span>
            ) : (
              <span className={cn('size-2 rounded-full', dotColor)} />
            )}
          </SidebarMenuAction>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-96 p-0">
          <JobsPopoverBody title={`${label}的任务`} jobs={jobs} onNavigate={onNavigate} onClose={() => handleOpenChange(false)} />
        </PopoverContent>
      </Popover>
    </>
  );
};

/**
 * 侧边栏底部固定的「后台任务」入口（设置上方）：进入任务页。
 * 有进行中的任务时右侧显示数量（不呼吸，与模块上的标记区分）；有没看过的失败时图标带红点，进入任务页后消失。
 */
export const JobsNavItem: React.FC<{ current: boolean; onNavigate: NavigateFn }> = ({ current, onNavigate }) => {
  const jobs = useJobs();
  const seenAt = useJobsSeenAt('jobs');
  const active = jobs.filter(isJobActive).length;
  const unseenFailure = !current && jobs.some((j) => j.status === 'failed' && finishedAfter(j, seenAt));

  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={current} tooltip={active > 0 ? `后台任务 · ${active} 个进行中` : '后台任务'} className="relative" onClick={() => onNavigate('jobs')}>
        <ListTodo />
        <span>后台任务</span>
        {unseenFailure && <span aria-hidden className="absolute top-1.5 left-5 size-2 rounded-full bg-destructive" />}
      </SidebarMenuButton>
      {active > 0 && <SidebarMenuBadge className="rounded-full border px-1.5 text-muted-foreground">{active}</SidebarMenuBadge>}
    </SidebarMenuItem>
  );
};

/**
 * 整窗页面（没有侧边栏，如剪辑编辑器）工具栏上的任务按钮：有进行中的任务时显示数量，点开是全部任务的浮层。
 */
export const JobsButton: React.FC<{ onNavigate: NavigateFn }> = ({ onNavigate }) => {
  const jobs = useJobs();
  const [open, setOpen] = useState(false);
  const active = jobs.filter(isJobActive).length;
  if (active === 0 && !open) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`${active} 个任务进行中`}>
          <ListTodo />
          <span className="tabular-nums">{active}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <JobsPopoverBody title="后台任务" jobs={jobs} onNavigate={onNavigate} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
};
