import React, { useEffect, useMemo, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PlanProgressBar } from '@/components/PlanProgressBar/PlanProgressBar';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { calculateTimeProgress } from '@/utils/timeProgress';
import { formatDate, localDaysBetween, parseLocalDate } from '@/utils/datetime';
import { useToday } from '@/hooks/useToday';
import { PLAN_STATUS } from '@/types/study';
import type { StudyPlanStatistics, StudyPlanWithProgress, TodayStudySchedule, UnifiedStudyPlanStatus } from '@/types';
import type { TodayPassageTask } from '@/types/passage';
import { todayLine } from '@/utils/planToday';
import { scheduleLabel } from '@/utils/incompletePractice';
import { studyService } from '@/services/studyService';
import { intervalLabel } from '@/components/PlanPassagePicker';

export interface PlanSummaryCardProps {
  /** 学习计划 */
  plan: StudyPlanWithProgress;
  /** 打开计划详情 */
  onOpen: (planId: number) => void;
  /** 主操作（开始 / 继续学习等，按状态由调用方决定行为） */
  onAction: (planId: number) => void;
  /** 这个计划今天要练的单词日程（含过期待补） */
  todaySchedule?: TodayStudySchedule;
  /** 这个计划今天的短文任务（到期没完成的 + 今天完成的） */
  todayPassages?: TodayPassageTask[];
}


function actionLabel(status: UnifiedStudyPlanStatus): string {
  if (status === 'Draft') return '编辑计划';
  if (status === 'Completed' || status === 'Terminated') return '重新学习';
  if (status === 'Pending') return '开始学习';
  if (status === 'Active') return '继续学习';
  return '查看详情';
}

/** 按日期算“第几天”：开始前 / 进行中 / 已过结束日 */
function dayPosition(startDate: string | undefined, totalDays: number, today: string): string {
  const start = parseLocalDate(startDate?.slice(0, 10));
  const todayDate = parseLocalDate(today);
  if (!start || !todayDate || totalDays <= 0) return '';
  const diff = localDaysBetween(start, todayDate);
  if (diff < 0) return `${formatDate(start)}开始`;
  if (diff >= totalDays) return '已过结束日期';
  return `第 ${diff + 1} / ${totalDays} 天`;
}

/**
 * 学习计划摘要（shadcn，整行卡片），首页与学习计划页共用。
 * 每张卡自行拉取 get_study_plan_statistics。右键与 ⋯ 菜单为同一组操作。
 * 四栏：计划（名称 / 状态 / 参数）→ 单词进度（已学 / 总数、进度条 + 时间刻度、正确率）→ 日程（第几天、日程方块）→ 主操作。
 */
export const PlanSummaryCard: React.FC<PlanSummaryCardProps> = ({ plan, onOpen, onAction, todaySchedule, todayPassages = [] }) => {
  const [statistics, setStatistics] = useState<StudyPlanStatistics | null>(null);
  const [statisticsLoading, setStatisticsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setStatisticsLoading(true);
    studyService.getStudyPlanStatistics(plan.id).then((result) => {
      if (cancelled) return;
      if (result.success) setStatistics(result.data);
      setStatisticsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [plan.id]);

  const status = plan.unified_status;
  /** 日程栏的“今天”一行（单词 + 短文） */
  const todayInfo = todayLine(todaySchedule, todayPassages, scheduleLabel);
  const today = useToday();
  // today 变化（跨零点）时重新计算
  const timeProgress = useMemo(
    () => calculateTimeProgress(plan.start_date, plan.end_date, parseLocalDate(today) ?? new Date()),
    [plan.start_date, plan.end_date, today]
  );
  // 首页看「已学」（练过一次）：掌握要间隔 7 天后仍写对，计划前十来天都是 0；掌握数放在下方说明里
  // 只练短文的计划：进度与日程都按短文篇数
  const passagesOnly = plan.practice_content === 'passages';
  const learnedWords = statistics?.learned_words ?? 0;
  const learnProgress = passagesOnly
    ? plan.total_passages > 0 ? (plan.completed_passages / plan.total_passages) * 100 : 0
    : plan.total_words > 0 ? (learnedWords / plan.total_words) * 100 : 0;

  const passageDays = plan.total_passages > 0 ? (plan.total_passages - 1) * plan.passage_interval_days + 1 : 0;
  const totalDays = passagesOnly ? plan.total_passages : statistics?.total_days || plan.study_period_days || 0;
  const completedDays = passagesOnly ? plan.completed_passages : statistics?.completed_days ?? 0;
  const overdueDays = passagesOnly ? 0 : statistics?.overdue_days ?? 0;
  const upcomingDays = Math.max(0, totalDays - completedDays - overdueDays);
  const blocks = Array.from({ length: totalDays }, (_, i) =>
    i < completedDays ? 'done' : i < completedDays + overdueDays ? 'overdue' : 'upcoming'
  );

  const meta = [
    passagesOnly ? intervalLabel(plan.passage_interval_days) : `周期 ${plan.study_period_days || 0} 天`,
    plan.start_date || plan.end_date ? `${formatDate(plan.start_date) || '—'} – ${formatDate(plan.end_date) || '—'}` : '',
    plan.practice_content === 'both' ? `${plan.total_passages} 篇短文` : '',
  ].filter(Boolean).join(' · ');

  const accuracy = learnedWords > 0 ? `${Math.round(statistics?.average_accuracy_rate || 0)}%` : '—';

  const menuItems = (Item: typeof DropdownMenuItem | typeof ContextMenuItem) => (
    <>
      <Item onSelect={() => onOpen(plan.id)}>查看详情</Item>
      <Item onSelect={() => onAction(plan.id)}>{actionLabel(status)}</Item>
    </>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Card
          className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-8 px-5 py-4 transition-colors hover:border-ring/60"
          onClick={() => onOpen(plan.id)}
        >
          {/* 计划 */}
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="truncate text-left text-[15px] font-semibold outline-none focus-visible:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(plan.id);
                }}
              >
                {plan.name}
              </button>
              <Badge variant="outline" className={cn('shrink-0 border-transparent', PLAN_STATUS[status].badgeClass)}>
                {PLAN_STATUS[status].label}
              </Badge>
            </div>
            <div className="truncate text-xs text-muted-foreground">{meta}</div>
            {plan.description && <div className="truncate text-sm text-muted-foreground">{plan.description}</div>}
          </div>

          {/* 单词进度 */}
          <div className="min-w-0 space-y-2">
            {passagesOnly ? (
              <div className="flex items-baseline justify-between gap-2">
                <span className="tabular-nums">
                  <span className="text-xl font-semibold">{plan.completed_passages}</span>
                  <span className="text-sm text-muted-foreground"> / {plan.total_passages} 篇短文已完成</span>
                </span>
                <span className="text-sm font-medium text-primary tabular-nums">{Math.round(learnProgress)}%</span>
              </div>
            ) : statisticsLoading ? (
              <Skeleton className="h-6 w-28" />
            ) : (
              <div className="flex items-baseline justify-between gap-2">
                <span className="tabular-nums">
                  <span className="text-xl font-semibold">{learnedWords}</span>
                  <span className="text-sm text-muted-foreground"> / {plan.total_words} 词已学</span>
                </span>
                <span className="text-sm font-medium text-primary tabular-nums">{Math.round(learnProgress)}%</span>
              </div>
            )}
            <PlanProgressBar
              learnProgress={learnProgress}
              timeProgress={timeProgress}
              status={status}
              caption={passagesOnly ? '只练短文' : statisticsLoading ? '正确率 …' : `正确率 ${accuracy} · 掌握 ${statistics?.completed_words ?? 0}`}
            />
          </div>

          {/* 日程 */}
          <div className="min-w-0 space-y-2">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{dayPosition(plan.start_date, passagesOnly ? passageDays : totalDays, today) || (passagesOnly ? '短文' : '日程')}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {statisticsLoading && !passagesOnly ? '…' : `完成 ${completedDays}/${totalDays}${passagesOnly ? ' 篇' : ''}`}
              </span>
            </div>
            <div className="flex flex-wrap gap-[3px]" aria-label={`日程：完成 ${completedDays}，延期 ${overdueDays}，未开始 ${upcomingDays}`}>
              {blocks.map((kind, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-3 min-w-2 flex-1 rounded-[3px]',
                    blocks.length > 14 && 'max-w-3',
                    kind === 'done' && 'bg-brand',
                    kind === 'overdue' && 'bg-overdue',
                    kind === 'upcoming' && 'bg-muted'
                  )}
                />
              ))}
            </div>
            {todayInfo ? (
              <div className={cn('truncate text-xs', todayInfo.warning ? 'text-warning' : 'text-muted-foreground')} title={todayInfo.text}>
                {todayInfo.text}
              </div>
            ) : (
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-brand" />完成 {completedDays}</span>
                {overdueDays > 0 && (
                  <span className="inline-flex items-center gap-1 text-warning"><span className="size-2 rounded-full bg-overdue" />延期 {overdueDays}</span>
                )}
                <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-muted-foreground/30" />未开始 {upcomingDays}</span>
              </div>
            )}
          </div>

          {/* 主操作 */}
          <div className="flex items-center gap-1">
            <Button
              variant={status === 'Active' || status === 'Pending' ? 'default' : 'outline'}
              onClick={(e) => {
                e.stopPropagation();
                onAction(plan.id);
              }}
            >
              {actionLabel(status)}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="更多操作" onClick={(e) => e.stopPropagation()}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                {menuItems(DropdownMenuItem)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Card>
      </ContextMenuTrigger>
      <ContextMenuContent>{menuItems(ContextMenuItem)}</ContextMenuContent>
    </ContextMenu>
  );
};
