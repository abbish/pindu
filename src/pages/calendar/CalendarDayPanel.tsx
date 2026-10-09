import React from 'react';
import { CalendarCheck, FileText, Play, SpellCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDate, formatWeekday, parseLocalDate } from '@/utils/datetime';
import { MODE_LABEL } from '@/utils/passage';
import type { CalendarDayData, CalendarPassageTask, CalendarStudyPlan } from '@/types';
import type { MonthlyStats } from '../CalendarPage';

export interface CalendarDayPanelProps {
  /** 选中的日期 YYYY-MM-DD */
  date: string;
  /** 今天 YYYY-MM-DD */
  today: string;
  /** 选中日期的数据（不在当前加载的月份范围内时为空） */
  day: CalendarDayData | undefined;
  loading: boolean;
  /** 本月统计（已换算为显示值） */
  monthlyStats: MonthlyStats;
  /** 练这个计划在这天的单词日程 */
  onPracticeWords: (plan: CalendarStudyPlan) => void;
  /** 做这项短文任务（有题组进练习，只朗读进朗读页） */
  onDoPassage: (task: CalendarPassageTask) => void;
  /** 打开短文（已完成的回看） */
  onOpenPassage: (task: CalendarPassageTask) => void;
  onOpenPlan: (planId: number) => void;
}

/** 能练习的计划状态（待开始的计划第一次练习时自动开始） */
const canPractice = (status: string) => status === 'pending' || status === 'active';

type When = 'past' | 'today' | 'future';

function wordsState(plan: CalendarStudyPlan, when: When): { badge: string; badgeClass: string; action: string } {
  if (plan.practiced) return { badge: '已练完', badgeClass: 'bg-success-soft text-success', action: '再练一次' };
  if (plan.in_progress) return { badge: '练了一半', badgeClass: 'bg-accent text-accent-foreground', action: '继续练习' };
  if (when === 'past') return { badge: '待补', badgeClass: 'bg-warning-soft text-warning', action: '补练' };
  if (when === 'future') return { badge: '未开始', badgeClass: 'bg-secondary text-secondary-foreground', action: '提前练' };
  return { badge: '未开始', badgeClass: 'bg-secondary text-secondary-foreground', action: '开始练习' };
}

function passageState(task: CalendarPassageTask, when: When): { badge: string; badgeClass: string } {
  if (task.completed) return { badge: '已完成', badgeClass: 'bg-success-soft text-success' };
  if (when === 'past') return { badge: '逾期', badgeClass: 'bg-warning-soft text-warning' };
  return { badge: '未完成', badgeClass: 'bg-secondary text-secondary-foreground' };
}

/** 一行任务：图标 + 标题 / 说明 + 状态 + 操作 */
const TaskRow: React.FC<{
  icon: React.ReactNode;
  title: React.ReactNode;
  badge: string;
  badgeClass: string;
  detail: React.ReactNode;
  action?: React.ReactNode;
  done?: boolean;
}> = ({ icon, title, badge, badgeClass, detail, action, done }) => (
  <div className={cn('flex flex-col gap-2 rounded-lg border p-3', done && 'opacity-75')}>
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
      <Badge variant="outline" className={cn('shrink-0 border-transparent font-normal', badgeClass)}>
        {badge}
      </Badge>
    </div>
    {action}
  </div>
);

/** 日历右栏：选中那天的安排（单词日程、短文任务）与当天的练习记录，下面是本月统计 */
export const CalendarDayPanel: React.FC<CalendarDayPanelProps> = ({
  date,
  today,
  day,
  loading,
  monthlyStats,
  onPracticeWords,
  onDoPassage,
  onOpenPassage,
  onOpenPlan,
}) => {
  const parsed = parseLocalDate(date);
  const when: When = date < today ? 'past' : date > today ? 'future' : 'today';
  const plans = day?.study_plans ?? [];
  const passages = day?.passages ?? [];
  const sessions = day?.study_sessions ?? [];
  const empty = plans.length === 0 && passages.length === 0 && sessions.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            {parsed ? `${formatDate(parsed)} ${formatWeekday(parsed)}` : date}
            {when === 'today' && <Badge className="font-normal">今天</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 px-4">
          {loading && !day ? (
            [0, 1].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)
          ) : empty ? (
            <div className="flex flex-col items-center gap-1.5 py-4 text-sm text-muted-foreground">
              <CalendarCheck className="size-5" />
              这天没有安排
            </div>
          ) : (
            <>
              {plans.map((plan) => {
                const st = wordsState(plan, when);
                const counts = [
                  plan.new_words_count > 0 && `新词 ${plan.new_words_count}`,
                  plan.review_words_count > 0 && `复习 ${plan.review_words_count}`,
                  `通过 ${plan.completed_words_count}/${plan.total_words_count}`,
                ].filter(Boolean);
                return (
                  <TaskRow
                    key={`w-${plan.schedule_id}`}
                    icon={<SpellCheck className="size-4" />}
                    title={
                      <button type="button" className="hover:underline" onClick={() => onOpenPlan(plan.plan_id)}>
                        {plan.plan_name}
                      </button>
                    }
                    detail={`单词 · ${counts.join(' · ')}`}
                    badge={st.badge}
                    badgeClass={st.badgeClass}
                    done={plan.practiced}
                    action={
                      canPractice(plan.unified_status) && (
                        <Button size="sm" variant={plan.practiced ? 'outline' : 'default'} onClick={() => onPracticeWords(plan)}>
                          <Play />
                          {st.action}
                        </Button>
                      )
                    }
                  />
                );
              })}
              {passages.map((task) => {
                const st = passageState(task, when);
                const how = task.set_id === null ? (task.is_video ? '看视频跟读' : '只朗读') : MODE_LABEL[task.mode];
                return (
                  <TaskRow
                    key={`p-${task.plan_id}-${task.passage_id}`}
                    icon={<FileText className="size-4" />}
                    title={
                      <button type="button" className="hover:underline" onClick={() => onOpenPassage(task)}>
                        {task.title}
                      </button>
                    }
                    detail={
                      <>
                        短文 · {how} ·{' '}
                        <button type="button" className="hover:underline" onClick={() => onOpenPlan(task.plan_id)}>
                          {task.plan_name}
                        </button>
                      </>
                    }
                    badge={st.badge}
                    badgeClass={st.badgeClass}
                    done={task.completed}
                    action={
                      !task.completed && canPractice(task.unified_status) && (
                        <Button size="sm" onClick={() => onDoPassage(task)}>
                          <Play />
                          {task.set_id === null ? (task.is_video ? '去观看' : '去朗读') : '开始练习'}
                        </Button>
                      )
                    }
                  />
                );
              })}
              {sessions.length > 0 && (
                <div className="flex flex-col gap-1 pt-1">
                  <div className="text-xs font-medium text-muted-foreground">练习记录</div>
                  {sessions.map((s, i) => (
                    <div key={`${s.session_id}-${i}`} className="flex justify-between gap-2 text-xs">
                      <span className="truncate">{s.plan_name}</span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {s.words_studied} 词 · 正确率 {Math.round(s.accuracy_rate)}% · {s.study_time_minutes} 分钟
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 本月统计 */}
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">本月统计</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 px-4">
          {[
            { label: '学习天数', value: `${monthlyStats.studyDays}/${monthlyStats.totalDays}`, unit: '天' },
            { label: '通过单词', value: monthlyStats.wordsLearned, unit: '个' },
            { label: '平均每个学习日', value: monthlyStats.averageDaily.toFixed(1), unit: '词' },
            { label: '连续天数', value: monthlyStats.streakDays, unit: '天' },
          ].map((s) => (
            <div key={s.label}>
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-lg font-semibold tabular-nums">
                {s.value}
                <span className="ml-0.5 text-xs font-normal text-muted-foreground">{s.unit}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};
