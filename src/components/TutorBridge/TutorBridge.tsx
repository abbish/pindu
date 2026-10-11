import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useToast } from '@/components/Toast/ToastContainer';
import { startPlanPractice } from '@/hooks/usePlanPractice';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { studyService } from '@/services/studyService';
import type { NavigateFn, PageKey, RouteParams } from '@/navigation';

/** 开始某个计划今天的练习（open_page 的 practice 目标；与计划卡「开始学习」同一套规则） */
const PRACTICE = '__practice';

/**
 * AI 老师在界面上的动作（MCP 工具 open_page / read_aloud 发来的事件）：打开页面、开始练习、朗读。
 * 放在 ToastProvider 里（开始练习失败要提示），App 级常驻。
 */
export const TutorBridge: React.FC<{ onNavigate: NavigateFn }> = ({ onNavigate }) => {
  const toast = useToast();
  const audio = useAudioPlayer();

  useEffect(() => {
    const offs: Promise<() => void>[] = [
      listen<{ page: string; params: Record<string, unknown> | null }>('tutor-open-page', async ({ payload }) => {
        if (payload.page === PRACTICE) {
          const planId = Number(payload.params?.planId);
          const result = await studyService.getStudyPlan(planId);
          const plan = result.success ? result.data : undefined;
          await startPlanPractice(plan, planId, onNavigate, toast);
          return;
        }
        // 页面键与参数由后端按 navigation.ts 的路由表给出
        (onNavigate as (page: PageKey, params?: RouteParams[PageKey]) => void)(
          payload.page as PageKey,
          (payload.params ?? undefined) as RouteParams[PageKey]
        );
      }),
      listen<{ text: string; slow: boolean }>('tutor-speak', ({ payload }) => {
        void audio.playWord(payload.text, undefined, payload.slow ? { speed: 'slow' } : undefined);
      }),
    ];
    return () => offs.forEach((off) => void off.then((fn) => fn()));
  }, [onNavigate, toast, audio]);

  return null;
};
