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
import { formatDate, parseLocalDate } from '@/utils/datetime';
import { useToday } from '@/hooks/useToday';
import { PLAN_STATUS } from '@/types/study';
import type { StudyPlanStatistics, StudyPlanWithProgress, TodayStudySchedule, UnifiedStudyPlanStatus } from '@/types';
import type { PlanDay, PlanDayStatus } from '@/types/study';
import type { TodayPassageTask } from '@/types/passage';
import { todayLine } from '@/utils/planToday';
import { scheduleLabel } from '@/utils/incompletePractice';
import { studyService } from '@/services/studyService';
import { intervalLabel } from '@/components/PlanPassagePicker';
import { JobProgress, activeJobFor } from '@/components/Jobs';
import { useJobs } from '@/hooks/useJobs';
import { SEND_LABEL, sendToDevice } from '@/components/SendToDevice';
import { SelectCheckbox } from '@/components/MaterialSelection/MaterialSelection';

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
  /** 多选（计划列表）：勾选状态与切换；不传则没有勾选框 */
  select?: { checked: boolean; selecting: boolean; onToggle: () => void };
}


/** 主按钮：只有能练的计划有（还没练过「开始学习」，练过「继续学习」）；其他状态点卡片看详情 */
function actionLabel(status: UnifiedStudyPlanStatus): string | null {
  if (status === 'Pending') return '开始学习';
  if (status === 'Active') return '继续学习';
  return null;
}

/** 按计划周期算“第几天”：开始前 / 进行中 / 已过结束日 */
function dayPosition(days: PlanDay[], today: string): string {
  if (days.length === 0) return '';
  const index = days.findIndex((d) => d.date === today);
  if (index >= 0) return `第 ${index + 1} / ${days.length} 天`;
  if (today < days[0].date) return `${formatDate(days[0].date)}开始 · ${days.length} 天`;
  return `已过结束日期 · ${days.length} 天`;
}

/** 日程格：每天一格，按日期 */
const DAY_CLASS: Record<PlanDayStatus, string> = {
  done: 'bg-brand',
  missed: 'bg-overdue',
  today: 'bg-muted ring-2 ring-brand ring-inset',
  upcoming: 'bg-muted',
  skipped: 'bg-muted',
  rest: 'bg-muted/40',
};
const DAY_LABEL: Record<PlanDayStatus, string> = {
  done: '练完',
  missed: '没练',
  today: '今天',
  upcoming: '要练',
  skipped: '没练',
  rest: '没有任务',
};

/**
 * 学习计划摘要（shadcn，整行卡片），首页与学习计划页共用。
 * 每张卡自行拉取 get_study_plan_statistics。右键与 ⋯ 菜单为同一组操作。
 * 四栏：计划（名称 / 状态 / 参数）→ 进度（已学 / 总数、已学 + 掌握两段进度条与时间刻度、一次答对率）→ 日程（计划周期第几天、每天一格）→ 主操作。
 */
export const PlanSummaryCard: React.FC<PlanSummaryCardProps> = ({ plan, onOpen, onAction, todaySchedule, todayPassages = [], select }) => {
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
  // 进度条：浅色已学（练过一次），深色已掌握（隔 7 天还能写对，决定计划完成）；只练短文按篇数
  const passagesOnly = plan.practice_content === 'passages';
  const learnedWords = statistics?.learned_words ?? 0;
  const pct = (n: number, total: number) => (total > 0 ? (n / total) * 100 : 0);
  const learnProgress = passagesOnly ? pct(plan.completed_passages, plan.total_passages) : pct(learnedWords, plan.total_words);
  const masteredProgress = passagesOnly ? undefined : pct(statistics?.completed_words ?? 0, plan.total_words);

  // 日程：计划周期每天一格（按日期；巩固期没有任务的日子浅色）
  const days = statistics?.days ?? [];
  const completedDays = statistics?.completed_days ?? 0;
  const overdueDays = statistics?.overdue_days ?? 0;

  const meta = [
    passagesOnly ? intervalLabel(plan.passage_interval_days) : `每天 ${plan.daily_new_words || 0} 个新词`,
    plan.start_date || plan.end_date ? `${formatDate(plan.start_date) || '—'} – ${formatDate(plan.end_date) || '—'}` : '',
    plan.practice_content === 'both' ? `${plan.total_passages} 篇短文` : '',
  ].filter(Boolean).join(' · ');

  const accuracy = learnedWords > 0 ? `${Math.round(statistics?.average_accuracy_rate || 0)}%` : '—';
  const caption = passagesOnly
    ? '只练短文'
    : statisticsLoading
      ? '一次答对率 …'
      : [
          `一次答对率 ${accuracy}`,
          `掌握 ${statistics?.completed_words ?? 0}`,
          plan.practice_content === 'both' ? `短文 ${plan.completed_passages}/${plan.total_passages}` : '',
        ].filter(Boolean).join(' · ');

  const action = actionLabel(status);
  /** 新建后在后台按从易到难排学习顺序：排好前不开始练习（否则先学到的是词汇本顺序） */
  const ordering = activeJobFor(useJobs(), ['plan_ordering'], 'planId', plan.id);
  const menuItems = (Item: typeof DropdownMenuItem | typeof ContextMenuItem) => (
    <>
      {action && !ordering && <Item onSelect={() => onAction(plan.id)}>{action}</Item>}
      <Item onSelect={() => onOpen(plan.id)}>查看详情</Item>
      <Item onSelect={() => sendToDevice({ items: [{ kind: 'plan', id: plan.id }], title: plan.name })}>{SEND_LABEL}</Item>
    </>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Card
          className={cn(
            'group grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-8 px-5 py-4 transition-colors hover:border-ring/60',
            select?.checked && 'border-primary ring-2 ring-primary/30'
          )}
          onClick={() => (select?.selecting ? select.onToggle() : onOpen(plan.id))}
        >
          {/* 计划 */}
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="truncate text-left text-[15px] font-semibold outline-none focus-visible:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  if (select?.selecting) select.onToggle();
                  else onOpen(plan.id);
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
              masteredProgress={masteredProgress}
              timeProgress={timeProgress}
              overdueDays={statisticsLoading ? undefined : overdueDays}
              status={status}
              caption={caption}
            />
          </div>

          {/* 日程 */}
          <div className="min-w-0 space-y-2">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{dayPosition(days, today) || '日程'}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{statisticsLoading ? '…' : `练完 ${completedDays} 天`}</span>
            </div>
            <div className="flex flex-wrap gap-[3px]" aria-label={`日程：练完 ${completedDays} 天，没练 ${overdueDays} 天，共 ${days.length} 天`}>
              {days.map((d) => (
                <span
                  key={d.date}
                  title={`${formatDate(d.date)} · ${DAY_LABEL[d.status]}`}
                  className={cn('h-3 min-w-2 flex-1 rounded-[3px]', days.length > 14 && 'max-w-3', DAY_CLASS[d.status])}
                />
              ))}
            </div>
            {ordering ? (
              <JobProgress job={ordering} fallback="正在安排学习顺序" />
            ) : todayInfo ? (
              <div className={cn('truncate text-xs', todayInfo.warning ? 'text-warning' : 'text-muted-foreground')} title={todayInfo.text}>
                {todayInfo.text}
              </div>
            ) : (
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-brand" />练完 {completedDays}</span>
                {overdueDays > 0 && (
                  <span className="inline-flex items-center gap-1 text-warning"><span className="size-2 rounded-full bg-overdue" />没练 {overdueDays}</span>
                )}
              </div>
            )}
          </div>

          {/* 主操作 */}
          <div className="flex items-center gap-1">
            {action && (
              <Button
                disabled={!!ordering}
                title={ordering ? '学习顺序排好后就能开始' : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  onAction(plan.id);
                }}
              >
                {action}
              </Button>
            )}
            {select && <SelectCheckbox inline checked={select.checked} selecting={select.selecting} onToggle={select.onToggle} label={`选择「${plan.name}」`} />}
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
