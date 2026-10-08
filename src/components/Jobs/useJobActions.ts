import { useCallback, useMemo } from 'react';
import { useToast } from '@/components/Toast/ToastContainer';
import { forgetJobs, setJobsSheetOpen } from '@/hooks/useJobs';
import { jobService } from '@/services/jobService';
import type { NavigateFn, PageKey } from '@/navigation';
import type { Job } from '@/types/job';

/** 任务的操作：停止、打开结果、移除（顶栏浮层与任务面板共用） */
export function useJobActions(onNavigate: NavigateFn) {
  const toast = useToast();

  const cancel = useCallback(
    async (job: Job) => {
      const result = await jobService.cancel(job.id);
      if (!result.success) toast.showError('无法停止任务', result.error);
    },
    [toast]
  );

  const open = useCallback(
    (job: Job) => {
      if (!job.link) return;
      setJobsSheetOpen(false);
      // 页面键与参数由后端按 navigation.ts 的路由表给出
      (onNavigate as (page: PageKey, params?: unknown) => void)(job.link.page as PageKey, job.link.params);
    },
    [onNavigate]
  );

  const remove = useCallback(async (job: Job) => {
    forgetJobs([job.id]);
    await jobService.remove(job.id);
  }, []);

  return useMemo(() => ({ cancel, open, remove }), [cancel, open, remove]);
}
