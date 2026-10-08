import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/Toast/ToastContainer';
import { isJobWatched, setJobsSheetOpen, startJobSync, useJobs } from '@/hooks/useJobs';
import { jobService } from '@/services/jobService';
import type { NavigateFn } from '@/navigation';
import { isJobActive, type Job } from '@/types/job';
import { jobErrorText } from './JobItem';
import { JobsSheet } from './JobsSheet';
import { useJobActions } from './useJobActions';

/**
 * 后台任务的 App 级部分：同步任务状态、任务面板、菜单「窗口 → 后台任务」、
 * 后台任务结束时的提示（发起页面还开着就不提示，页面里已经有进度）、退出确认。
 */
export const JobCenter: React.FC<{ onNavigate: NavigateFn }> = ({ onNavigate }) => {
  const jobs = useJobs();
  const toast = useToast();
  const actions = useJobActions(onNavigate);
  const [quitTitles, setQuitTitles] = useState<string[] | null>(null);
  const lastStatus = useRef(new Map<string, Job['status']>());

  useEffect(() => {
    void startJobSync();
    const unlisteners = [
      listen('menu-show-jobs', () => setJobsSheetOpen(true)),
      listen<string[]>('quit-requested', (event) => setQuitTitles(event.payload)),
    ];
    return () => unlisteners.forEach((p) => p.then((off) => off()));
  }, []);

  // 后台任务刚结束：没有页面在看时提示一次
  useEffect(() => {
    for (const job of jobs) {
      const before = lastStatus.current.get(job.id);
      lastStatus.current.set(job.id, job.status);
      if (!before || !isJobActive({ status: before }) || isJobActive(job)) continue;
      if (!job.detached || isJobWatched(job.id)) continue;
      if (job.status === 'succeeded') {
        toast.showToast({
          type: 'success',
          title: `已完成：${job.title}`,
          action: job.link ? { label: '打开', onClick: () => actions.open(job) } : undefined,
        });
      } else if (job.status === 'failed') {
        toast.showToast({
          type: 'error',
          title: `没有完成：${job.title}`,
          message: jobErrorText(job),
          action: { label: '查看', onClick: () => setJobsSheetOpen(true) },
        });
      }
    }
  }, [jobs, toast, actions]);

  const quit = async () => {
    const result = await jobService.quit();
    if (!result.success) toast.showError('无法退出', result.error);
  };

  return (
    <>
      <JobsSheet onNavigate={onNavigate} />
      <AlertDialog open={quitTitles !== null} onOpenChange={(open) => !open && setQuitTitles(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>还有 {quitTitles?.length ?? 0} 个任务在进行</AlertDialogTitle>
            <AlertDialogDescription>
              {quitTitles?.slice(0, 3).join('、')}
              {(quitTitles?.length ?? 0) > 3 ? ' 等' : ''}。现在退出会中断它们，已经完成的部分会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续等待</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={quit}>
              退出
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
