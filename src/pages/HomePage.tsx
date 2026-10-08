import React, { useEffect, useState } from 'react';
import { CalendarPlus, CircleCheckBig, Flame, Plus, Target, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePlanPractice } from '@/hooks/usePlanPractice';
import { useToast } from '@/components/Toast/ToastContainer';
import { IncompletePracticeModal } from '@/components/IncompletePracticeModal';
import { ContinuePracticeBanner } from '@/components/ContinuePracticeBanner/ContinuePracticeBanner';
import { PlanSummaryCard } from '@/components/PlanSummaryCard/PlanSummaryCard';
import { LearningHeatmap } from '@/components/LearningHeatmap/LearningHeatmap';
import { MetricCard } from '@/components/MetricCard/MetricCard';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { studyService } from '@/services/studyService';
import { calendarService } from '@/services/calendarService';
import { practiceService } from '@/services/practiceService';
import { passageService } from '@/services/passageService';
import { useAsyncData } from '@/hooks/useAsyncData';
import { type PracticeSession } from '@/types/study';
import type { NavigateFn } from '@/navigation';
import { claimLaunchReminder } from '@/utils/incompletePractice';
import { PageError } from '@/components/PageError';

export interface HomePageProps {
  /** Navigation handler */
  onNavigate?: NavigateFn;
}

/** 区块标题 + 右侧链接（如“查看全部”） */
const SectionHeader: React.FC<{ title: string; onViewAll?: () => void; viewAllLabel?: string }> = ({
  title,
  onViewAll,
  viewAllLabel = '查看全部',
}) => (
  <div className="flex min-h-8 items-center justify-between">
    <h2 className="text-base font-semibold">{title}</h2>
    {onViewAll && (
      <Button variant="ghost" size="sm" onClick={onViewAll}>
        {viewAllLabel}
      </Button>
    )}
  </div>
);

/** 首页数据：各数据源分别加载，失败的按来源列出（不影响其它区块显示） */
async function loadHomeData() {
  const [studyPlans, todaySchedules, statistics, activity, passageTasks] = await Promise.all([
    studyService.getAllStudyPlans(),
    // 后端会先把今天到期的复习同步进今天的日程
    calendarService.getTodayStudySchedules(),
    studyService.getStudyStatistics(),
    // 热力图最多显示 53 周
    studyService.getDailyLearningActivity(53 * 7),
    passageService.getTodayPassageTasks(),
  ]);
  const sources = [
    ['学习计划', studyPlans],
    ['今天的日程', todaySchedules],
    ['学习统计', statistics],
    ['学习热力图', activity],
    ['今天的短文', passageTasks],
  ] as const;
  return {
    studyPlans: studyPlans.success ? studyPlans.data : [],
    todaySchedules: todaySchedules.success ? todaySchedules.data : [],
    statistics: statistics.success ? statistics.data : null,
    activity: activity.success ? activity.data : [],
    passageTasks: passageTasks.success ? passageTasks.data : [],
    errors: sources.flatMap(([label, r]) => (r.success ? [] : [`${label}：${r.error}`])),
  };
}

/**
 * 首页：继续上次练习 → 学习计划 → 学习统计。今天要做的（单词日程 + 到期短文）并在计划卡里：
 * 日程栏显示今天的内容，「继续学习」接着做今天没做完的（`utils/planToday.ts`）。
 * 单词本、短文库在侧边栏「素材库」，首页不再单列（2026-10-07 用户确认）。
 * 功能清单见 .claude/work/ui-shadcn-migration/feature-inventory.md §1。
 */
export const HomePage: React.FC<HomePageProps> = ({ onNavigate }) => {
  const toast = useToast();

  // 未完成练习相关状态
  const [incompleteSessions, setIncompleteSessions] = useState<PracticeSession[]>([]);
  const [showIncompleteModal, setShowIncompleteModal] = useState(false);

  const { data, loading, refresh } = useAsyncData(loadHomeData);

  // 未完成练习：每次进首页都读取，用于首页「继续上次练习」条
  useEffect(() => {
    let cancelled = false;
    practiceService.getIncompletePracticeSessions().then(result => {
      if (!cancelled && result.success) setIncompleteSessions(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 提醒弹框：每次启动只在第一次进首页时检查一次（回到首页、刚退出练习都不再打断）
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!claimLaunchReminder()) return;
      const result = await practiceService.getIncompletePracticeSessions();
      if (result.success && result.data.length > 0) {
        setIncompleteSessions(result.data);
        setShowIncompleteModal(true);
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  // 只显示正式计划（排除已删除、草稿）
  const studyPlans = (data?.studyPlans ?? []).filter(
    (plan) => plan.unified_status !== 'Deleted' && plan.unified_status !== 'Draft'
  );
  const statistics = data?.statistics || {
    total_words_learned: 0,
    average_accuracy: 0,
    streak_days: 0,
    completion_rate: 0,
    weekly_progress: [],
  };

  const handlePlanClick = (planId: number) => {
    onNavigate?.('plan-detail', { planId });
  };


  const handleStudyStart = usePlanPractice(studyPlans, onNavigate, 'home');

  const handleCreatePlan = () => {
    onNavigate?.('create-plan');
  };

  const handleContinuePractice = (session: PracticeSession) => {
    setShowIncompleteModal(false);
    onNavigate?.('word-practice', {
      planId: session.planId,
      scheduleId: session.scheduleId,
      sessionId: session.sessionId,
      returnTo: 'home',
    });
  };

  const handleDiscardPractice = async (session: PracticeSession) => {
    const result = await practiceService.cancelPracticeSession(session.sessionId);
    if (!result.success) {
      toast.showError('无法放弃这次练习', result.error);
      return;
    }
    const remaining = incompleteSessions.filter((s) => s.sessionId !== session.sessionId);
    setIncompleteSessions(remaining);
    if (remaining.length === 0) setShowIncompleteModal(false);
    toast.showSuccess('已放弃这次练习');
  };

  const passageTasks = data?.passageTasks ?? [];
  const todaySchedules = data?.todaySchedules ?? [];
  const errors = data?.errors ?? [];

  const stats = [
    { label: '总学习单词', value: String(statistics.total_words_learned || 0), unit: '个', icon: CircleCheckBig },
    { label: '平均正确率', value: (statistics.average_accuracy || 0).toFixed(0), unit: '%', icon: Target },
    { label: '连续学习', value: String(statistics.streak_days || 0), unit: '天', icon: Flame },
    { label: '计划完成率', value: (statistics.completion_rate || 0).toFixed(0), unit: '%', icon: Trophy },
  ];
  const activity = data?.activity ?? [];

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-8 py-7">
      {/* 页头：欢迎语 + 快捷操作 */}
      <PageHeader
        title="欢迎回来"
        actions={
          <Button onClick={handleCreatePlan}>
            <CalendarPlus />
            创建学习计划
          </Button>
        }
      />

      {/* 继续上次练习（提醒弹框关掉后的常驻入口） */}
      {!showIncompleteModal && (
        <ContinuePracticeBanner
          sessions={incompleteSessions}
          onContinue={handleContinuePractice}
          onShowAll={() => setShowIncompleteModal(true)}
        />
      )}

      {/* 数据加载错误：按数据源列出，可重试 */}
      {errors.length > 0 && (
        <PageError
          title="首页有部分内容没能加载"
          message={
            <ul className="list-inside list-disc">
              {errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          }
          onRetry={refresh}
        />
      )}

      {/* 我的学习计划 */}
      <section className="flex flex-col gap-3">
        <SectionHeader title="我的学习计划" onViewAll={() => onNavigate?.('plans')} />
        <div className="flex flex-col gap-3">
          {loading ? (
            [0, 1].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)
          ) : studyPlans.length > 0 ? (
            studyPlans.map((plan) => (
              <PlanSummaryCard
                key={plan.id}
                plan={plan}
                onOpen={handlePlanClick}
                onAction={handleStudyStart}
                todaySchedule={todaySchedules.find((t) => t.plan_id === plan.id)}
                todayPassages={passageTasks.filter((t) => t.planId === plan.id)}
              />
            ))
          ) : (
            <EmptyState
              className="col-span-full"
              actionIcon={<Plus />}
              icon={<CalendarPlus />}
              title="还没有学习计划"
              action="创建学习计划"
              onAction={() => onNavigate?.('create-plan')}
            />
          )}
        </div>
      </section>

      {/* 学习统计：左 4 个指标，右 学习热力图 */}
      <section className="flex flex-col gap-3">
        <SectionHeader title="学习统计" />
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
          <div className="grid grid-cols-2 gap-3">
            {stats.map((s) => (
              <MetricCard key={s.label} {...s} loading={loading} />
            ))}
          </div>
          <LearningHeatmap activity={activity} loading={loading} />
        </div>
      </section>

      {/* 未完成练习提醒 */}
      <IncompletePracticeModal
        isOpen={showIncompleteModal}
        sessions={incompleteSessions}
        onContinue={handleContinuePractice}
        onDiscard={handleDiscardPractice}
        onClose={() => setShowIncompleteModal(false)}
      />
    </div>
  );
};
