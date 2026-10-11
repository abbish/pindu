import React, { useMemo, useState } from 'react';
import { FolderOpen, ListChecks, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePlanPractice } from '@/hooks/usePlanPractice';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { PlanSummaryCard } from '@/components/PlanSummaryCard/PlanSummaryCard';
import { studyService } from '@/services/studyService';
import { calendarService } from '@/services/calendarService';
import { passageService } from '@/services/passageService';
import { useAsyncData } from '@/hooks/useAsyncData';
import type { NavigateFn } from '@/navigation';
import type { StudyPlanWithProgress, UnifiedStudyPlanStatus } from '@/types';
import { PLAN_STATUS } from '@/types/study';
import { PageError } from '@/components/PageError';
import { SortSelect, useSortPref } from '@/components/SortSelect';
import { byInstant, byNumber, byText, sortItems, type SortOption } from '@/utils/sorting';

export interface StudyPlansPageProps {
  /** Navigation handler */
  onNavigate?: NavigateFn;
}

/** 页签：全部 / 在学（待开始、进行中、已暂停）/ 已结束（已完成、已结束） */
type StatusFilter = 'all' | 'learning' | 'ended';

/** 分组顺序（“全部”视图）。删除是物理删除，列表里不会出现已删除的计划 */
const GROUPS: { status: UnifiedStudyPlanStatus; label: string }[] = (
  ['Active', 'Pending', 'Paused', 'Draft', 'Completed', 'Terminated'] as const
).map((status) => ({ status, label: PLAN_STATUS[status].label }));

/** 计划排序（「全部」视图里在每个状态分组内排） */
const PLAN_SORTS: SortOption<StudyPlanWithProgress>[] = [
  { value: 'recent', label: '最近创建', compare: byInstant((p) => p.created_at) },
  { value: 'start', label: '最近开始', compare: (a, b) => byText<StudyPlanWithProgress>((p) => p.start_date ?? '')(b, a) },
  { value: 'name', label: '名称', compare: byText((p) => p.name) },
  { value: 'progress', label: '进度最高', compare: byNumber((p) => p.progress_percentage) },
];

const FILTERS: { value: StatusFilter; label: string; statuses: UnifiedStudyPlanStatus[] }[] = [
  { value: 'all', label: '全部', statuses: GROUPS.map((g) => g.status) },
  { value: 'learning', label: '在学', statuses: ['Active', 'Pending', 'Paused', 'Draft'] },
  { value: 'ended', label: '已结束', statuses: ['Completed', 'Terminated'] },
];

/**
 * 学习计划列表（shadcn，外壳由 AppShell 提供）：页签（全部 / 在学 / 已结束，带数量）+ 排序 + 按状态分组的计划（plan-ux B2）。
 * 功能清单见 .claude/work/ui-shadcn-migration/feature-inventory.md §2。
 */
export const StudyPlansPage: React.FC<StudyPlansPageProps> = ({ onNavigate }) => {
  const { data: studyPlans, loading, error, refresh } = useAsyncData(async () => {
    const result = await studyService.getAllStudyPlans();
    if (result.success) {
      return result.data;
    } else {
      throw new Error(result.error);
    }
  });
  // 计划卡日程栏的“今天”（单词日程 + 到期短文）；拿不到时卡片退回显示图例
  const { data: today } = useAsyncData(async () => {
    const [schedules, passages] = await Promise.all([calendarService.getTodayStudySchedules(), passageService.getTodayPassageTasks()]);
    return { schedules: schedules.success ? schedules.data : [], passages: passages.success ? passages.data : [] };
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useSortPref('plans', PLAN_SORTS);

  const byStatus = useMemo(() => {
    const map = new Map<UnifiedStudyPlanStatus, StudyPlanWithProgress[]>();
    for (const plan of sortItems(studyPlans ?? [], PLAN_SORTS, sortBy)) {
      const status = plan.unified_status as UnifiedStudyPlanStatus;
      map.set(status, [...(map.get(status) ?? []), plan]);
    }
    return map;
  }, [studyPlans, sortBy]);
  const statusesOf = (filter: StatusFilter) => FILTERS.find((f) => f.value === filter)?.statuses ?? [];
  const countOf = (filter: StatusFilter) => statusesOf(filter).reduce((n, st) => n + (byStatus.get(st)?.length ?? 0), 0);

  const handlePlanClick = (planId: number) => {
    onNavigate?.('plan-detail', { planId });
  };

  const handleStudyStart = usePlanPractice(studyPlans, onNavigate);

  const renderPlans = (plans: StudyPlanWithProgress[]) => (
    <div className="flex flex-col gap-3">
      {plans.map((plan) => (
        <PlanSummaryCard
          key={plan.id}
          plan={plan}
          onOpen={handlePlanClick}
          onAction={handleStudyStart}
          todaySchedule={today?.schedules.find((t) => t.plan_id === plan.id)}
          todayPassages={today?.passages.filter((t) => t.planId === plan.id)}
        />
      ))}
    </div>
  );

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      );
    }

    const shown = statusesOf(statusFilter);
    const groups = GROUPS.filter((g) => shown.includes(g.status))
      .map((g) => ({ ...g, plans: byStatus.get(g.status) ?? [] }))
      .filter((g) => g.plans.length > 0);
    if (groups.length === 0 && statusFilter !== 'all') {
      return <EmptyState icon={<FolderOpen />} title={statusFilter === 'learning' ? '没有在学的计划' : '没有已结束的计划'} />;
    }
    if (groups.length === 0) {
      return (
        <EmptyState
          icon={<ListChecks />}
          title="还没有学习计划"
          action="创建计划"
          actionIcon={<Plus />}
          onAction={() => onNavigate?.('create-plan')}
        />
      );
    }
    return (
      <div className="flex flex-col gap-6">
        {groups.map((g) => (
          <section key={g.status} className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              {g.label}
              <Badge variant="secondary" className="tabular-nums">{g.plans.length}</Badge>
            </h2>
            {renderPlans(g.plans)}
          </section>
        ))}
      </div>
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-8 py-7">
      <PageHeader
        title="计划"
        actions={
          <Button onClick={() => onNavigate?.('create-plan')}>
            <Plus />
            创建计划
          </Button>
        }
      />

      {error && (
        <PageError title="无法加载学习计划" message={error.message} onRetry={refresh} />
      )}

      <div className="flex items-center justify-between gap-2">
      <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
        <TabsList>
          {FILTERS.map((f) => (
            <TabsTrigger key={f.value} value={f.value} className="gap-1.5 px-3">
              {f.label}
              {!loading && <span className="text-xs text-muted-foreground tabular-nums">{countOf(f.value)}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
        <SortSelect value={sortBy} options={PLAN_SORTS} onChange={setSortBy} />
      </div>

      {renderContent()}
    </div>
  );
};
