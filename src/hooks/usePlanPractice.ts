import { useCallback } from 'react';
import { useToast } from '@/components/Toast/ToastContainer';
import { studyService } from '@/services/studyService';
import { calendarService } from '@/services/calendarService';
import { passageService } from '@/services/passageService';
import { pickPracticeSchedule } from '@/utils/schedulePick';
import { nextStepOf } from '@/utils/planToday';
import type { NavigateFn, PassagePracticeReturn } from '@/navigation';
import type { StudyPlanWithProgress } from '@/types';

/**
 * 从计划卡片“开始 / 继续学习”：接着做这个计划今天还没做完的（规则见 `utils/planToday.ts::nextStepOf`）——
 * 今天的单词没练完 → 单词练习；单词练完或只练短文 → 到期的那篇短文（有题组进练习，只朗读进朗读页）；
 * 都没有 → 单词计划进入该练的日程，只练短文的计划打开详情。
 * 待开始的计划在第一次练习时由后端自动转为进行中；其他状态打开计划详情。首页与学习计划列表共用。
 */
export function usePlanPractice(
  plans: StudyPlanWithProgress[] | null | undefined,
  onNavigate?: NavigateFn,
  /** 练完 / 退出回到哪里（单词练习、短文练习、朗读页都按它返回） */
  returnTo: PassagePracticeReturn = 'plan-detail'
) {
  const toast = useToast();

  return useCallback(
    async (planId: number) => {
      const plan = plans?.find((p) => p.id === planId);
      if (!plan || (plan.unified_status !== 'Pending' && plan.unified_status !== 'Active')) {
        onNavigate?.('plan-detail', { planId });
        return;
      }
      const [schedules, passages] = await Promise.all([
        calendarService.getTodayStudySchedules(),
        passageService.getTodayPassageTasks(),
      ]);
      const step = nextStepOf(
        plan.practice_content,
        schedules.success ? schedules.data.find((t) => t.plan_id === planId) : undefined,
        passages.success ? passages.data.filter((t) => t.planId === planId) : []
      );
      if (step.kind === 'passage') {
        const t = step.task;
        if (t.setId !== null) {
          onNavigate?.('passage-practice', { setId: t.setId, mode: t.mode, planId, returnTo });
        } else {
          onNavigate?.('passage-detail', { passageId: t.passageId, fromPlan: { planId, planName: t.planName }, returnTo });
        }
        return;
      }
      if (plan.practice_content === 'passages') {
        onNavigate?.('plan-detail', { planId });
        return;
      }
      const result = await studyService.getStudyPlanSchedules(planId);
      if (!result.success) {
        toast.showError('无法开始练习', result.error);
        return;
      }
      const target = pickPracticeSchedule(result.data);
      if (target) {
        onNavigate?.('word-practice', { planId, scheduleId: target.id, returnTo });
      } else {
        toast.showInfo('日程都已练完', '可以在计划详情里再练一次');
        onNavigate?.('plan-detail', { planId });
      }
    },
    [plans, onNavigate, toast, returnTo]
  );
}
