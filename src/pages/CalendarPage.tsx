import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PageError } from '@/components/PageError';
import { useToday } from '@/hooks/useToday';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { cn } from '@/lib/utils';
import { calendarService } from '@/services';
import type { CalendarMonthResponse, LoadingState } from '@/types';
import type { NavigateFn } from '@/navigation';
import { CalendarDayPanel } from './calendar/CalendarDayPanel';
import { localToday } from '@/utils/datetime';

/** 日格学习状态 */
type StudyStatus = 'completed' | 'partial' | 'missed' | 'planned';

/** 月度统计（侧栏显示值） */
export interface MonthlyStats {
  studyDays: number;
  totalDays: number;
  wordsLearned: number;
  averageDaily: number;
  streakDays: number;
}

export interface CalendarPageProps {
  /** Navigation handler */
  onNavigate?: NavigateFn;
}

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 状态 → 日格底色 / 图例 */
const STATUS_STYLE: Record<StudyStatus, { cell: string; dot: string; label: string }> = {
  completed: { cell: 'bg-success-soft/60', dot: 'bg-success', label: '已完成目标' },
  partial: { cell: 'bg-warning-soft/60', dot: 'bg-overdue', label: '部分完成' },
  missed: { cell: 'bg-destructive/8', dot: 'bg-destructive', label: '未完成' },
  planned: { cell: '', dot: 'bg-muted-foreground/40', label: '计划中' },
};

/**
 * 学习日历（shadcn，外壳由 AppShell 提供）：月历 + 右侧「选中那天」的安排（默认今天，点日格切换）与本月统计。
 * 「今天要做什么」与「继续上次练习」在首页；这里按日期看安排、补练与提前练。
 * 功能清单见 .claude/work/ui-shadcn-migration/feature-inventory.md §12。
 */
export const CalendarPage: React.FC<CalendarPageProps> = ({ onNavigate }) => {
  const [currentDate, setCurrentDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [calendarData, setCalendarData] = useState<CalendarMonthResponse | null>(null);
  const [loading, setLoading] = useState<LoadingState>({ loading: false });
  const today = useToday();
  /** 选中的日期（右栏显示这天的安排） */
  const [selectedDate, setSelectedDate] = useState(today);
  const [monthError, setMonthError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 月历数据（快速切换月份时只采用最后一次请求的结果）
  useEffect(() => {
    let stale = false;
    calendarService
      .getMonthData({ year: currentDate.getFullYear(), month: currentDate.getMonth() + 1, includeOtherMonths: true }, setLoading)
      .then((result) => {
        if (stale) return;
        // 页面级错误：在月历上方显示（带重试），不用 toast
        if (result.success) {
          setCalendarData(result.data);
          setMonthError(null);
        } else {
          // 不保留上个月的格子：标题已是新月份，旧数据会全部显示成「非本月」
          setCalendarData(null);
          setMonthError(result.error);
        }
      });
    return () => {
      stale = true;
    };
  }, [currentDate, reloadKey]);

  const monthlyStats: MonthlyStats = useMemo(() => {
    const stats = calendarData?.monthly_stats;
    if (!stats) return { studyDays: 0, totalDays: 0, wordsLearned: 0, averageDaily: 0, streakDays: 0 };
    return {
      studyDays: stats.study_days || 0,
      totalDays: stats.total_days || 0,
      wordsLearned: stats.total_words_learned || 0,
      // 平均每个学习日掌握的词数（不按整月天数平均）
      averageDaily: stats.study_days > 0 ? (stats.total_words_learned || 0) / stats.study_days : 0,
      streakDays: stats.streak_days || 0,
    };
  }, [calendarData]);

  const days = useMemo(() => {
    if (!calendarData?.days) return [];
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;
    return calendarData.days.map((day) => {
      // 'YYYY-MM-DD' 按本地日期解析（new Date('YYYY-MM-DD') 会当成 UTC，西半球会差一天）
      const [y, m, d] = day.date.split('-').map(Number);
      const status: StudyStatus =
        day.status === 'completed' ? 'completed' : day.status === 'in-progress' ? 'partial' : day.status === 'overdue' ? 'missed' : 'planned';
      return {
        key: day.date,
        dayOfMonth: d,
        month: m,
        status,
        isToday: day.is_today,
        isInPlan: day.is_in_plan,
        isCurrentMonth: y === year && m === month,
        newWords: day.new_words_count || 0,
        reviewWords: day.review_words_count || 0,
        passages: day.passage_tasks || 0,
        passagesDone: day.passage_completed || 0,
        learned: day.completed_words_count || 0,
        target: day.total_words_count || 0,
        plans: day.study_plans?.map((plan) => plan.plan_name || '未命名计划') ?? [],
      };
    });
  }, [calendarData, currentDate]);

  /** 切换月份：选中这个月的今天（不是本月则选 1 号） */
  const showMonth = (first: Date) => {
    setCurrentDate(first);
    const now = new Date();
    setSelectedDate(
      first.getFullYear() === now.getFullYear() && first.getMonth() === now.getMonth() ? today : localToday(first)
    );
  };
  const shiftMonth = (delta: number) => showMonth(new Date(currentDate.getFullYear(), currentDate.getMonth() + delta, 1));
  const selectedDay = calendarData?.days.find((d) => d.date === selectedDate);
  const isThisMonth = (() => {
    const now = new Date();
    return currentDate.getFullYear() === now.getFullYear() && currentDate.getMonth() === now.getMonth();
  })();

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-8 py-7">
      <PageHeader
        title="学习日历"
        description="查看学习计划和每日完成情况"
        actions={
          <Button onClick={() => onNavigate?.('create-plan')}>
            <Plus />
            新建计划
          </Button>
        }
      />

      {monthError && <PageError title="无法加载日历" message={monthError} onRetry={() => setReloadKey((k) => k + 1)} />}

      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4">
        {/* 月历 */}
        <Card className="gap-4 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" aria-label="上个月" onClick={() => shiftMonth(-1)}>
                <ChevronLeft />
              </Button>
              <Button variant="outline" size="icon" aria-label="下个月" onClick={() => shiftMonth(1)}>
                <ChevronRight />
              </Button>
              <h2 className="ml-2 text-lg font-semibold tabular-nums">
                {currentDate.getFullYear()}年{currentDate.getMonth() + 1}月
              </h2>
            </div>
            {!isThisMonth && (
              <Button variant="ghost" size="sm" onClick={() => showMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
                回到本月
              </Button>
            )}
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAYS.map((w) => (
              <div key={w} className="pb-1 text-center text-xs font-medium text-muted-foreground">{w}</div>
            ))}
            {loading.loading && days.length === 0
              ? Array.from({ length: 35 }, (_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)
              : days.map((day) => {
                  const showPlan = day.isCurrentMonth && day.isInPlan;
                  const selected = day.key === selectedDate;
                  const cell = (
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSelectedDate(day.key)}
                      className={cn(
                        'flex h-24 flex-col gap-1 rounded-lg border p-2 text-left transition-colors outline-none hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring',
                        !day.isCurrentMonth && 'border-transparent bg-transparent text-muted-foreground/50',
                        showPlan && STATUS_STYLE[day.status].cell,
                        day.isToday && 'border-primary',
                        selected && 'ring-2 ring-primary'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={cn(
                            'flex size-6 items-center justify-center rounded-full text-sm tabular-nums',
                            day.isToday && 'bg-primary font-semibold text-primary-foreground'
                          )}
                        >
                          {day.dayOfMonth}
                        </span>
                        {showPlan && day.status !== 'planned' && (
                          <span className={cn('size-2 rounded-full', STATUS_STYLE[day.status].dot)} />
                        )}
                      </div>
                      {showPlan && (
                        <>
                          <div className="flex flex-wrap gap-1 text-[11px] leading-tight">
                            {day.newWords > 0 && <span className="rounded bg-accent px-1 text-accent-foreground">新{day.newWords}</span>}
                            {day.reviewWords > 0 && <span className="rounded bg-secondary px-1 text-secondary-foreground">复{day.reviewWords}</span>}
                            {day.passages > 0 && <span className="rounded border px-1 text-foreground">文{day.passages}</span>}
                          </div>
                          <div className="mt-auto h-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-brand"
                              style={{ width: `${day.target > 0 ? (day.learned / day.target) * 100 : 0}%` }}
                            />
                          </div>
                        </>
                      )}
                    </button>
                  );
                  return showPlan ? (
                    <Tooltip key={day.key}>
                      <TooltipTrigger asChild>{cell}</TooltipTrigger>
                      <TooltipContent className="max-w-60">
                        <div className="font-medium">{day.month}月{day.dayOfMonth}日 · {STATUS_STYLE[day.status].label}</div>
                        {day.target > 0 && <div>新学 {day.newWords} · 复习 {day.reviewWords} · 已练 {day.learned}/{day.target}</div>}
                        {day.passages > 0 && <div>短文 {day.passages} 篇 · 已完成 {day.passagesDone}</div>}
                        {day.plans.length > 0 && <div className="opacity-80">{day.plans.join('、')}</div>}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <React.Fragment key={day.key}>{cell}</React.Fragment>
                  );
                })}
          </div>

          {/* 图例 */}
          <div className="flex flex-wrap items-center gap-4 border-t pt-3 text-xs text-muted-foreground">
            {(['completed', 'partial', 'missed'] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={cn('size-2 rounded-full', STATUS_STYLE[s].dot)} />
                {STATUS_STYLE[s].label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[9px] text-primary-foreground">7</span>
              今天
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="rounded bg-accent px-1 text-accent-foreground">新</span>新学
              <span className="rounded bg-secondary px-1 text-secondary-foreground">复</span>复习
              <span className="rounded border px-1 text-foreground">文</span>短文
            </span>
          </div>
        </Card>

        <CalendarDayPanel
          date={selectedDate}
          today={today}
          day={selectedDay}
          loading={loading.loading}
          monthlyStats={monthlyStats}
          onPracticeWords={(plan) => onNavigate?.('word-practice', { planId: plan.plan_id, scheduleId: plan.schedule_id, returnTo: 'calendar' })}
          onDoPassage={(t) =>
            t.set_id !== null
              ? onNavigate?.('passage-practice', { setId: t.set_id, mode: t.mode, planId: t.plan_id, returnTo: 'calendar' })
              : onNavigate?.('passage-detail', { passageId: t.passage_id, fromPlan: { planId: t.plan_id, planName: t.plan_name }, returnTo: 'calendar' })
          }
          onOpenPassage={(t) => onNavigate?.('passage-detail', { passageId: t.passage_id, fromPlan: { planId: t.plan_id, planName: t.plan_name }, returnTo: 'calendar' })}
          onOpenPlan={(planId) => onNavigate?.('plan-detail', { planId })}
        />
      </div>

    </div>
  );
};
