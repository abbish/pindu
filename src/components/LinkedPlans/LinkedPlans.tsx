import React, { useCallback, useEffect, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { PageError } from '@/components/PageError';
import { tagService } from '@/services/tagService';
import { PLAN_STATUS, type StudyPlanWithProgress, type UnifiedStudyPlanStatus } from '@/types/study';
import type { MaterialKind } from '@/types/material';

/** 用到这个素材的学习计划（词汇本 / 短文与场景片段共用）；refId 为空时不加载 */
export function useLinkedPlans(kind: MaterialKind, refId: number | null | undefined) {
  const [plans, setPlans] = useState<StudyPlanWithProgress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!refId) return;
    const result = await tagService.getLinkedPlans(kind, refId);
    if (result.success) {
      setPlans(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [kind, refId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { plans, error, reload };
}

/** 卡片上的计划数：用于 N 个计划 / 未加入计划 */
export const PlanUsageBadge: React.FC<{ count: number }> = ({ count }) =>
  count > 0 ? (
    <Badge variant="outline" className="border-transparent bg-accent text-accent-foreground">
      用于 {count} 个计划
    </Badge>
  ) : (
    <span className="text-xs text-muted-foreground">未加入计划</span>
  );

/** 详情页「关联计划」页签：计划名、状态、内容、进度，点「查看详情」去计划 */
export const LinkedPlanList: React.FC<{
  plans: StudyPlanWithProgress[] | null;
  error?: string | null;
  onRetry?: () => void;
  /** 空状态标题，如「还没有学习计划用到这篇短文」 */
  emptyTitle: string;
  onOpen: (planId: number) => void;
}> = ({ plans, error, onRetry, emptyTitle, onOpen }) => {
  if (error) return <PageError title="无法加载关联计划" message={error} onRetry={onRetry} />;
  if (!plans) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
    );
  }
  if (plans.length === 0) return <EmptyState icon={<ListChecks />} title={emptyTitle} />;
  return (
    <div className="flex flex-col gap-3">
      {plans.map((plan) => {
        const progress = plan.progress_percentage ?? 0;
        const content = [
          plan.total_words > 0 && `${plan.total_words} 个单词`,
          plan.total_passages > 0 && `${plan.total_passages} 篇短文`,
          plan.study_period_days ? `周期 ${plan.study_period_days} 天` : null,
        ];
        return (
          <Card key={plan.id} className="flex-row items-center gap-6 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold">{plan.name}</span>
                <Badge variant="secondary">{PLAN_STATUS[(plan.unified_status || 'Draft') as UnifiedStudyPlanStatus].label}</Badge>
              </div>
              <div className="mt-0.5 truncate text-sm text-muted-foreground">
                {[plan.description, ...content].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="w-48 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">学习进度</span>
                <span className="tabular-nums">{progress.toFixed(1)}%</span>
              </div>
              <Progress value={progress} className="h-1.5 [&>[data-slot=progress-indicator]]:bg-brand" />
            </div>
            <Button variant="outline" onClick={() => onOpen(plan.id)}>
              查看详情
            </Button>
          </Card>
        );
      })}
    </div>
  );
};
