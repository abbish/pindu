import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/Toast/ToastContainer';
import { formatDate, formatMonth, toLocalDateKey } from '@/utils/datetime';
import { studyService } from '@/services/studyService';
import type { CalendarDayData } from '@/types';

export interface StudyCalendarProps {
  /** 学习计划ID */
  planId: number;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

const STATUS: Record<CalendarDayData['status'], { cell: string; dot: string; label: string }> = {
  completed: { cell: 'bg-success-soft/60', dot: 'bg-success', label: '已完成' },
  'in-progress': { cell: 'bg-warning-soft/60', dot: 'bg-overdue', label: '进行中' },
  overdue: { cell: 'bg-destructive/8', dot: 'bg-destructive', label: '逾期' },
  'not-started': { cell: '', dot: 'bg-muted-foreground/40', label: '未开始' },
};

/** 当月网格（周一起），按日期键查数据，不依赖后端返回的排列顺序 */
function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7));
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const days = Math.ceil(((last.getDate() + ((first.getDay() + 6) % 7)) / 7)) * 7;
  return Array.from({ length: days }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** 计划日历（shadcn）：每格新学 / 复习数与完成进度，悬停看详情；周一起 */
export const StudyCalendar: React.FC<StudyCalendarProps> = ({ planId }) => {
  const toast = useToast();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [data, setData] = useState<CalendarDayData[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  useEffect(() => {
    if (!planId) return;
    let stale = false;
    setDataLoading(true);
    studyService.getStudyPlanCalendarData(planId, month.getFullYear(), month.getMonth() + 1).then((result) => {
      if (stale) return;
      if (result.success) setData(result.data);
      else {
        toast.showError('无法加载计划日历', result.error);
        setData([]);
      }
      setDataLoading(false);
    });
    return () => {
      stale = true;
    };
  }, [planId, month, toast]);

  const byDate = useMemo(() => new Map(data.map((d) => [d.date, d])), [data]);
  const grid = useMemo(() => monthGrid(month), [month]);
  const now = new Date();
  const isThisMonth = month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" aria-label="上个月" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon" aria-label="下个月" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}>
          <ChevronRight />
        </Button>
        <h3 className="ml-2 text-base font-semibold tabular-nums">{formatMonth(month)}</h3>
        {!isThisMonth && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setMonth(new Date(now.getFullYear(), now.getMonth(), 1))}>
            回到本月
          </Button>
        )}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 text-center text-xs font-medium text-muted-foreground">周{w}</div>
        ))}
        {dataLoading && data.length === 0
          ? grid.map((d) => <Skeleton key={toLocalDateKey(d)} className="h-20 rounded-lg" />)
          : grid.map((d) => {
              const key = toLocalDateKey(d);
              const day = byDate.get(key);
              const inMonth = d.getMonth() === month.getMonth();
              const inPlan = !!day?.is_in_plan && inMonth;
              const isToday = key === toLocalDateKey(now);
              const status = day ? STATUS[day.status] : STATUS['not-started'];
              const cell = (
                <div
                  className={cn(
                    'flex h-20 flex-col gap-1 rounded-lg border p-1.5',
                    !inMonth && 'border-transparent text-muted-foreground/50',
                    inPlan && status.cell,
                    isToday && 'border-primary ring-1 ring-primary'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        'flex size-5 items-center justify-center rounded-full text-xs tabular-nums',
                        isToday && 'bg-primary font-semibold text-primary-foreground'
                      )}
                    >
                      {d.getDate()}
                    </span>
                    {inPlan && day?.status !== 'not-started' && <span className={cn('size-1.5 rounded-full', status.dot)} />}
                  </div>
                  {inPlan && day && (
                    <>
                      <div className="flex flex-wrap gap-0.5 text-[10px] leading-tight">
                        {day.new_words_count > 0 && <span className="rounded bg-accent px-1 text-accent-foreground">新{day.new_words_count}</span>}
                        {day.review_words_count > 0 && <span className="rounded bg-secondary px-1 text-secondary-foreground">复{day.review_words_count}</span>}
                        {day.passage_tasks > 0 && <span className="rounded border px-1 text-foreground">文{day.passage_tasks}</span>}
                      </div>
                      <div className="mt-auto h-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${day.progress_percentage || 0}%` }} />
                      </div>
                    </>
                  )}
                </div>
              );
              return inPlan && day ? (
                <Tooltip key={key}>
                  <TooltipTrigger asChild>{cell}</TooltipTrigger>
                  <TooltipContent>
                    <div className="font-medium">{formatDate(key)} · {status.label}</div>
                    {day.total_words_count > 0 && (
                      <div>新学 {day.new_words_count} · 复习 {day.review_words_count} · 已练 {day.completed_words_count}/{day.total_words_count}</div>
                    )}
                    {day.passage_tasks > 0 && <div>短文 {day.passage_tasks} 篇 · 已完成 {day.passage_completed}</div>}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <React.Fragment key={key}>{cell}</React.Fragment>
              );
            })}
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t pt-3 text-xs text-muted-foreground">
        {(['completed', 'in-progress', 'overdue', 'not-started'] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn('size-2 rounded-full', STATUS[s].dot)} />
            {STATUS[s].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded bg-accent px-1 text-accent-foreground">新</span>新学
          <span className="rounded bg-secondary px-1 text-secondary-foreground">复</span>复习
          <span className="rounded border px-1 text-foreground">文</span>短文
        </span>
      </div>
    </div>
  );
};
