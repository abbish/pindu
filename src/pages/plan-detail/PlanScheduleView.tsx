import React, { Fragment, useMemo, useState } from 'react';
import { CalendarX, ChevronDown, ChevronRight, Info, Play, RotateCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { cn } from '@/lib/utils';
import { formatDate, formatDuration, formatWeekday } from '@/utils/datetime';
import type { PlanScheduleSummary, PracticeSession } from '@/types';

export interface PlanScheduleViewProps {
  /** 计划日程（get_study_plan_schedules，含当天单词；今天到期的复习已在今天的日程里） */
  schedules: PlanScheduleSummary[];
  /** 加载中 */
  loading: boolean;
  /** 练习会话（按日程汇总用时与暂停） */
  sessions: PracticeSession[];
  /** 今天 YYYY-MM-DD */
  today: string;
  /** 计划当前能否练习（待开始 / 进行中） */
  canPractice: boolean;
  /** 练习某个日程 */
  onStartPractice: (scheduleId: number) => void;
}

/**
 * 日程安排：每天新学 / 复习 / 练习情况，可展开当天的单词。
 * 新词日在创建计划时排好；复习按记忆等级到期当天自动加入（今天之后的日子只显示新词）。
 */
export const PlanScheduleView: React.FC<PlanScheduleViewProps> = ({ schedules, loading, sessions, today, canPractice, onStartPractice }) => {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const sessionsBySchedule = useMemo(() => {
    const map = new Map<number, PracticeSession[]>();
    for (const s of sessions) map.set(s.scheduleId, [...(map.get(s.scheduleId) ?? []), s]);
    return map;
  }, [sessions]);

  if (loading) return <Skeleton className="h-80 rounded-xl" />;
  if (schedules.length === 0) {
    return <EmptyState icon={<CalendarX />} title="暂无学习日程" description="编辑计划并生成日程后会显示在这里" />;
  }

  const newWordsTotal = schedules.reduce((n, s) => n + s.new_words_count, 0);
  const practicedDays = schedules.filter((s) => s.completed).length;
  const withWords = schedules.filter((s) => (s.words?.length ?? 0) > 0).map((s) => s.id);
  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm">
          共 <span className="font-semibold tabular-nums">{schedules.length}</span> 天 · {newWordsTotal} 个新词 · 已练完{' '}
          <span className="tabular-nums">{practicedDays}</span> 天
          <span className="ml-2 text-muted-foreground">复习按记忆等级到期当天自动加入，未来的日子只显示新词</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setExpanded(expanded.size > 0 ? new Set() : new Set(withWords))}>
          {expanded.size > 0 ? '收起全部' : '展开全部单词'}
        </Button>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead className="w-20">第几天</TableHead>
              <TableHead>日期</TableHead>
              <TableHead className="text-right">新学</TableHead>
              <TableHead className="text-right">复习</TableHead>
              <TableHead className="w-48">
                <Tooltip>
                  <TooltipTrigger className="inline-flex items-center gap-1">
                    首次全对 <Info className="size-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>练完后第一次作答就全对的单词数（新词三步、复习词一次听写）</TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead>练习</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedules.map((s) => {
              const daySessions = sessionsBySchedule.get(s.id) ?? [];
              const activeMs = daySessions.reduce((n, x) => n + (x.activeTime || 0), 0);
              const pauses = daySessions.reduce((n, x) => n + (x.pauseCount || 0), 0);
              const hasOpen = daySessions.some((x) => !x.completed);
              const isToday = s.schedule_date === today;
              const overdue = s.schedule_date < today && !s.completed;
              const words = s.words ?? [];
              const open = expanded.has(s.id);
              const total = s.word_count || s.new_words_count + s.review_words_count;
              const pct = total > 0 ? Math.min(100, (s.completed_words_count / total) * 100) : 0;
              const action = hasOpen ? '继续练习' : s.completed ? '再练一次' : '开始练习';
              return (
                <Fragment key={s.id}>
                  <TableRow className={cn(isToday && 'bg-accent/40')}>
                    <TableCell>
                      {words.length > 0 && (
                        <Button variant="ghost" size="icon" className="size-6" aria-label={open ? '收起单词' : '展开单词'} onClick={() => toggle(s.id)}>
                          {open ? <ChevronDown /> : <ChevronRight />}
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">第 {s.day} 天</TableCell>
                    <TableCell>
                      {formatDate(s.schedule_date)} <span className="text-muted-foreground">{formatWeekday(s.schedule_date)}</span>
                      {isToday && <Badge className="ml-2">今天</Badge>}
                      {overdue && <Badge variant="outline" className="ml-2 border-transparent bg-warning-soft text-warning">待补</Badge>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.new_words_count || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.review_words_count || '—'}</TableCell>
                    <TableCell>
                      {s.completed ? (
                        <div className="flex items-center gap-2">
                          <Progress value={pct} className="h-1.5 flex-1 [&>[data-slot=progress-indicator]]:bg-brand" />
                          <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{s.completed_words_count}/{total}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.completed ? (
                        <span className="text-success">已练完</span>
                      ) : hasOpen ? (
                        <span className="text-warning">练到一半</span>
                      ) : (
                        <span className="text-muted-foreground">未开始</span>
                      )}
                      {activeMs > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {formatDuration(activeMs)}
                          {pauses > 0 && ` · 暂停 ${pauses} 次`}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canPractice && total > 0 && (
                        <Button size="sm" variant={s.completed && !hasOpen ? 'outline' : 'default'} onClick={() => onStartPractice(s.id)}>
                          {s.completed && !hasOpen ? <RotateCw /> : <Play />}
                          {action}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  {open && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell />
                      <TableCell colSpan={7} className="whitespace-normal">
                        <div className="flex flex-wrap gap-1.5 py-1">
                          {words.map((w) => (
                            <span
                              key={`${w.word_id}-${w.is_review}`}
                              className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm', w.is_review && 'border-dashed')}
                            >
                              <span className="font-medium select-text">{w.word}</span>
                              {w.meaning && <span className="text-muted-foreground select-text">{w.meaning}</span>}
                              {w.is_review && (
                                <Badge variant="outline" className="border-transparent bg-secondary px-1.5 text-secondary-foreground">
                                  复习
                                </Badge>
                              )}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};
