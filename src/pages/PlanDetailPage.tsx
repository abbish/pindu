import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CircleCheckBig, Flame, Info, List, Loader2, MoreHorizontal, Pause, Play, RotateCw, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/Toast/ToastContainer';
import { PlanSettingsView } from './plan-detail/PlanSettingsView';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { PlanProgressBar } from '@/components/PlanProgressBar/PlanProgressBar';
import { usePageTitle } from '@/components/AppShell/pageTitle';
import { studyService } from '@/services/studyService';
import { practiceService } from '@/services/practiceService';
import { passageService } from '@/services/passageService';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useToday } from '@/hooks/useToday';
import { cn } from '@/lib/utils';
import { formatDate } from '@/utils/datetime';
import { pickPracticeSchedule } from '@/utils/schedulePick';
import { getAvailableActions, PLAN_STATUS } from '@/types/study';
import type {
  PlanMemoryOverview,
  PlanScheduleSummary,
  PracticeSession,
  StudyPlanAction,
  StudyPlanStatistics,
  StudyPlanWithProgress,
  StudyPlanWord,
  UnifiedStudyPlanStatus,
} from '@/types';
import type { NavigateFn } from '@/navigation';
import { calculateTimeProgress, getActionConfig, groupPlanActions } from './plan-detail/planDetailDisplay';
import { PlanOverviewView } from './plan-detail/PlanOverviewView';
import { PlanScheduleView } from './plan-detail/PlanScheduleView';
import { PlanWordsView } from './plan-detail/PlanWordsView';
import { PlanStatisticsView } from './plan-detail/PlanStatisticsView';
import { PlanLogsView } from './plan-detail/PlanLogsView';
import { PlanPassagesView } from './plan-detail/PlanPassagesView';
import type { PlanPassage } from '@/types/passage';
import { intervalLabel } from '@/components/PlanPassagePicker';
import { PageError } from '@/components/PageError';
import { InlineError } from '@/components/InlineError';
import { JobPanel, activeJobFor } from '@/components/Jobs';
import { useJobs, useOnJobFinished } from '@/hooks/useJobs';

type ViewMode = 'schedule' | 'words' | 'passages' | 'statistics' | 'settings';

export interface PlanDetailPageProps {
  /** Plan ID */
  planId: number;
  /** 打开时的页签（如从短文练习返回时为 passages） */
  initialTab?: 'passages';
  /** Navigation handler */
  onNavigate?: NavigateFn;
}

/** 需要确认的操作：标题问“要不要做”，说明只讲后果（与后端行为一致），确认按钮直接写动作 */
const CONFIRMS: Partial<Record<StudyPlanAction, { title: string; description: string; destructive?: boolean }>> = {
  restart: {
    title: '重新学习这个计划？',
    description: '练习记录和记忆等级会清空，日程从下次练习那天重新开始',
    destructive: true,
  },
  terminate: {
    title: '结束学习这个计划？',
    description: '结束后不能再练习，练习记录会保留；以后可以重新学习',
  },
  delete: {
    title: '删除这个计划？',
    description: '计划和全部练习记录会被删除，不能恢复，词汇本不受影响',
    destructive: true,
  },
  pause: {
    title: '暂停这个计划？',
    description: '暂停期间不能练习，继续时没练的日程按暂停的天数顺延',
  },
  resume: {
    title: '继续学习这个计划？',
    description: '没练的日程和复习日期会按暂停的天数顺延',
  },
};

/** 操作完成后的提示：标题说结果，描述只在有后续影响时补充 */
const SUCCESS_TOASTS: Partial<Record<StudyPlanAction, [string, string?]>> = {
  start: ['已开始学习'],
  pause: ['已暂停计划'],
  resume: ['已继续学习'],
  terminate: ['已结束学习'],
  restart: ['已重新开始'],
  publish: ['已发布计划'],
  delete: ['已删除计划'],
};

/** 计划单词按 word_id 去重后的词性分布 */
function partOfSpeechStats(words: StudyPlanWord[]): Record<string, number> {
  const unique = new Map(words.map((w) => [w.id, w]));
  const stats: Record<string, number> = {};
  unique.forEach((w) => {
    const pos = w.partOfSpeech || 'unknown';
    stats[pos] = (stats[pos] || 0) + 1;
  });
  return stats;
}

/**
 * 学习计划详情（shadcn，外壳由 AppShell 提供）：页头与状态操作、进度与记忆等级、关键指标、五个视图。
 * 功能清单见 .claude/work/ui-shadcn-migration/feature-inventory.md §4（自适应复习后的契约见 progress.md）。
 */
export const PlanDetailPage: React.FC<PlanDetailPageProps> = ({ planId, initialTab, onNavigate }) => {
  const toast = useToast();
  const audioPlayer = useAudioPlayer();
  const today = useToday();

  const [plan, setPlan] = useState<StudyPlanWithProgress | null>(null);
  const [statistics, setStatistics] = useState<StudyPlanStatistics | null>(null);
  const [memory, setMemory] = useState<PlanMemoryOverview | null>(null);
  const [schedules, setSchedules] = useState<PlanScheduleSummary[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(true);
  const [planWords, setPlanWords] = useState<StudyPlanWord[]>([]);
  const [wordsLoading, setWordsLoading] = useState(false);
  const [sessions, setSessions] = useState<PracticeSession[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [passageItems, setPassageItems] = useState<PlanPassage[]>([]);
  const [passagesLoading, setPassagesLoading] = useState(true);
  const [view, setView] = useState<ViewMode | null>(initialTab ?? null);
  /** 日程页签：列表 / 日历 */
  const [scheduleAs, setScheduleAs] = useState<'list' | 'calendar'>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<StudyPlanAction | null>(null);
  const [processing, setProcessing] = useState(false);
  /** 确认框里的操作失败原因（关闭确认框 / 换操作时清空） */
  const [actionError, setActionError] = useState<{ label: string; message: string } | null>(null);

  usePageTitle(plan?.name);
  /** 新建后在后台按从易到难排学习顺序：排好前不开始练习，排完重新加载日程 */
  const ordering = activeJobFor(useJobs(), ['plan_ordering'], 'planId', planId);

  const loadSchedules = useCallback(async () => {
    setSchedulesLoading(true);
    const result = await studyService.getStudyPlanSchedules(planId);
    if (result.success) setSchedules(result.data);
    setSchedulesLoading(false);
  }, [planId]);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    const result = await practiceService.getPlanPracticeSessions(planId);
    if (result.success) setSessions(result.data);
    else toast.showError('无法加载练习记录', result.error);
    setSessionsLoading(false);
  }, [planId, toast]);

  const loadPassages = useCallback(async () => {
    const result = await passageService.getPlanPassages(planId);
    if (result.success) setPassageItems(result.data);
    else toast.showError('无法加载计划里的短文', result.error);
    setPassagesLoading(false);
  }, [planId, toast]);

  const loadPlan = useCallback(async () => {
    setError(null);
    const result = await studyService.getStudyPlan(planId);
    if (!result.success) {
      setError(result.error);
      return false;
    }
    setPlan(result.data);
    return true;
  }, [planId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    if (await loadPlan()) {
      setWordsLoading(true);
      const [words, stats, mem] = await Promise.all([
        studyService.getStudyPlanWords(planId),
        studyService.getStudyPlanStatistics(planId),
        studyService.getPlanMemoryOverview(planId),
        loadSchedules(),
        loadPassages(),
      ]);
      if (words.success) setPlanWords(words.data);
      else toast.showError('无法加载计划单词', words.error);
      if (stats.success) setStatistics(stats.data);
      if (mem.success) setMemory(mem.data);
      setWordsLoading(false);
      setSessions(null); // 日志按需重新加载
    }
    setLoading(false);
  }, [planId, loadPlan, loadSchedules, loadPassages, toast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useOnJobFinished((job) => {
    if (job.kind === 'plan_ordering' && (job.link?.params as { planId?: number } | null)?.planId === planId) void loadAll();
  });

  // 默认页签：只练短文的计划看短文，其余看日程（列表）
  const contentKind = plan?.practice_content;
  useEffect(() => {
    if (contentKind && view === null) setView(contentKind === 'passages' ? 'passages' : 'schedule');
  }, [contentKind, view]);

  // 日程用时与练习记录（统计页签）都需要练习会话：切到这两个页签时加载一次
  useEffect(() => {
    if ((view === 'statistics' || view === 'schedule') && sessions === null && !sessionsLoading) loadSessions();
  }, [view, sessions, sessionsLoading, loadSessions]);

  const posStats = useMemo(() => partOfSpeechStats(planWords), [planWords]);
  const todaySchedule = schedules.find((s) => s.schedule_date === today);

  /** 执行一个状态操作；失败时确认框保持打开，方便重试或取消 */
  const runAction = async (action: StudyPlanAction) => {
    if (!plan) return;
    const calls: Partial<Record<StudyPlanAction, (id: number) => ReturnType<typeof studyService.startStudyPlan>>> = {
      start: (id) => studyService.startStudyPlan(id),
      pause: (id) => studyService.pauseStudyPlan(id),
      resume: (id) => studyService.resumeStudyPlan(id),
      complete: (id) => studyService.completeStudyPlan(id),
      terminate: (id) => studyService.terminateStudyPlan(id),
      restart: (id) => studyService.restartStudyPlan(id),
      publish: (id) => studyService.publishStudyPlan(id),
      delete: (id) => studyService.deleteStudyPlan(id),
    };
    const call = calls[action];
    if (!call) return;
    const label = getActionConfig(action, plan.unified_status as UnifiedStudyPlanStatus).label;
    setProcessing(true);
    setActionError(null);
    const result = await call(plan.id);
    setProcessing(false);
    if (!result.success) {
      // 走确认框的操作把原因留在框里；直接执行的（开始、发布）没有框，用轻提示
      if (CONFIRMS[action]) setActionError({ label, message: result.error });
      else toast.showError(`无法${label}`, result.error);
      return;
    }
    const [title, description] = SUCCESS_TOASTS[action] ?? [`已${label}`];
    toast.showSuccess(title, description);
    setPendingAction(null);
    if (action === 'delete') {
      onNavigate?.('plans');
      return;
    }
    await loadAll();
  };

  /** 有后果要说明的操作先确认，其余（开始、发布）直接执行 */
  const handleAction = (action: StudyPlanAction) => {
    if (!plan || processing) return;
    if (!getAvailableActions(plan.unified_status as UnifiedStudyPlanStatus).includes(action)) return;
    setActionError(null);
    if (CONFIRMS[action]) setPendingAction(action);
    else runAction(action);
  };

  const confirm = pendingAction ? CONFIRMS[pendingAction] : undefined;

  const practicePassage = (item: PlanPassage) => {
    if (!plan || item.setId === null) return;
    onNavigate?.('passage-practice', { setId: item.setId, mode: item.mode, planId: plan.id, returnTo: 'plan-detail' });
  };

  const markPassageRead = async (item: PlanPassage) => {
    if (!plan) return;
    const result = await passageService.completePlanPassageReading(plan.id, item.passageId);
    if (!result.success) {
      toast.showError('无法标记为已完成', result.error);
      return;
    }
    toast.showSuccess(`已完成「${item.title}」`);
    await loadAll();
  };

  const duePassages = passageItems.filter((p) => p.status === 'due' || p.status === 'overdue');

  /** 打开到期最早的短文任务：有题组进练习，只朗读 / 看视频进短文页；没有到期的返回 false */
  const openDuePassage = () => {
    if (!plan) return false;
    const next = [...duePassages].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.sortOrder - b.sortOrder)[0];
    if (!next) return false;
    if (next.setId !== null) practicePassage(next);
    else onNavigate?.('passage-detail', { passageId: next.passageId, fromPlan: { planId: plan.id, planName: plan.name } });
    return true;
  };

  const startPractice = async () => {
    if (!plan) return;
    if (plan.practice_content === 'passages') {
      if (!openDuePassage()) {
        const upcoming = passageItems.find((p) => p.status !== 'completed');
        if (upcoming) toast.showInfo('今天没有要做的短文', `下一篇 ${formatDate(upcoming.scheduledDate)}`);
        else toast.showInfo('短文都已完成');
      }
      return;
    }
    const result = await studyService.getStudyPlanSchedules(plan.id);
    if (!result.success) {
      toast.showError('无法开始练习', result.error);
      return;
    }
    if (result.data.length === 0) {
      toast.showInfo('这个计划还没有日程', '在「设置」页签追加词汇本');
      return;
    }
    // 统一规则：今天未练完 → 最早逾期 → 今天（再练）→ 第一个未练完；
    // 与首页「继续学习」一致：今天的单词没有要练的了，先做到期的短文
    const target = pickPracticeSchedule(result.data);
    const wordsDue = !!target && !target.completed && target.schedule_date <= today;
    if (!wordsDue && openDuePassage()) return;
    if (target) onNavigate?.('word-practice', { planId: plan.id, scheduleId: target.id });
  };

  const container = 'mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-8 py-7';

  if (loading && !plan) {
    return (
      <div className={container}>
        <Skeleton className="h-16 w-[480px]" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-36 rounded-xl" />
          <Skeleton className="h-36 rounded-xl" />
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (error || !plan) {
    return (
      <div className={container}>
        <PageError
          title="无法打开这个学习计划"
          message={error ?? '它可能已被删除'}
          onRetry={loadAll}
          back={{ label: '返回学习计划', onClick: () => onNavigate?.('plans') }}
        />
      </div>
    );
  }

  const status = plan.unified_status as UnifiedStudyPlanStatus;
  // 待开始 / 进行中都能直接练习（待开始的计划第一次练习时自动开始）
  const canPractice = status === 'Pending' || status === 'Active';
  const { primary, menu, danger } = groupPlanActions(getAvailableActions(status), status);
  const timeProgress = calculateTimeProgress(plan.start_date, plan.end_date);
  const withWords = plan.practice_content !== 'passages';
  const withPassages = plan.practice_content !== 'words';
  // 与计划卡同一口径：已学（练过一次）/ 全部单词；只练短文按篇数
  const learnProgress = !withWords
    ? (plan.total_passages > 0 ? (plan.completed_passages / plan.total_passages) * 100 : 0)
    : (plan.total_words > 0 ? ((statistics?.learned_words ?? 0) / plan.total_words) * 100 : 0);
  const meta = [
    withWords && plan.daily_new_words ? `每天 ${plan.daily_new_words} 个新词` : null,
    withPassages ? intervalLabel(plan.passage_interval_days) : null,
    plan.start_date || plan.end_date ? `${formatDate(plan.start_date) || '—'} – ${formatDate(plan.end_date) || '—'}` : null,
    withWords ? `${plan.total_words} 个单词` : null,
    withPassages ? `${plan.total_passages} 篇短文` : null,
  ].filter(Boolean).join(' · ');
  const nextPassage = passageItems.find((p) => p.status === 'upcoming');
  const missedDays = schedules.filter((s) => s.schedule_date < today && !s.completed).length;
  const nextScheduleDate = schedules.find((s) => s.schedule_date > today && !s.completed)?.schedule_date;
  const wordsToday = !!todaySchedule && !todaySchedule.completed && todaySchedule.word_count > 0;
  const memoryTotal = memory?.total || 0;
  const memorySegments = memory
    ? [
        { label: '未学', count: memory.not_started, className: 'bg-muted-foreground/20' },
        { label: '学习中', count: memory.learned - memory.mastered, className: 'bg-chart-1/70' },
        { label: '已掌握', count: memory.mastered, className: 'bg-chart-2' },
      ]
    : [];

  /** 「今天」卡：今天要做的事（单词 + 到期短文）与开始按钮在一处 */
  const todayLines: React.ReactNode[] = [];
  if (withWords && todaySchedule) {
    todayLines.push(
      todaySchedule.completed
        ? '今天的单词已练完'
        : [todaySchedule.new_words_count > 0 && `新学 ${todaySchedule.new_words_count} 个`, todaySchedule.review_words_count > 0 && `复习 ${todaySchedule.review_words_count} 个`].filter(Boolean).join('、') + '单词'
    );
  }
  if (withWords && missedDays > 0) todayLines.push(<span className="text-warning">之前还有 {missedDays} 天没练</span>);
  if (withPassages && duePassages.length > 0) {
    todayLines.push(
      <>
        短文「{duePassages[0].title}」{duePassages.length > 1 ? ` 等 ${duePassages.length} 篇` : ''}
        {duePassages.some((p) => p.status === 'overdue') && <span className="text-warning">（有逾期）</span>}
      </>
    );
  }
  const hasTodayWork = wordsToday || missedDays > 0 || duePassages.length > 0;
  const nextText = (() => {
    const dates = [withWords ? nextScheduleDate : undefined, withPassages ? nextPassage?.scheduledDate : undefined].filter((d): d is string => !!d).sort();
    return dates[0] ? `下次学习 ${formatDate(dates[0])}` : null;
  })();
  const notPracticeText = status === 'Paused' ? '计划已暂停，继续学习后才能练习' : status === 'Draft' ? '发布后才能练习' : '计划已结束，重新学习后才能练习';

  const tabs: { value: ViewMode; label: string; count?: number }[] = [
    { value: 'schedule', label: '日程' },
    ...(withWords ? [{ value: 'words' as const, label: '单词', count: planWords.length }] : []),
    ...(withPassages ? [{ value: 'passages' as const, label: '短文', count: plan.total_passages }] : []),
    ...(withWords ? [{ value: 'statistics' as const, label: '统计' }] : []),
    { value: 'settings', label: '设置' },
  ];

  return (
    <div className={container}>
      {/* 页头：名称、状态与状态操作（练习入口在「今天」卡里） */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{plan.name}</h1>
            <Badge variant="outline" className={cn('border-transparent', PLAN_STATUS[status].badgeClass)}>{PLAN_STATUS[status].label}</Badge>
          </div>
          {plan.description && <p className="text-sm text-muted-foreground select-text">{plan.description}</p>}
          <p className="text-xs text-muted-foreground">{meta}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {primary.map((action) => (
            <Button key={action} onClick={() => handleAction(action)}>
              {getActionConfig(action, status).label}
            </Button>
          ))}
          {menu.length + danger.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="更多操作">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {menu.map((action) => (
                  <DropdownMenuItem key={action} onSelect={() => handleAction(action)}>
                    {action === 'pause' ? <Pause /> : <CircleCheckBig />}
                    {getActionConfig(action, status).label}…
                  </DropdownMenuItem>
                ))}
                {menu.length > 0 && danger.length > 0 && <DropdownMenuSeparator />}
                {danger.map((action) => (
                  <DropdownMenuItem key={action} variant="destructive" onSelect={() => handleAction(action)}>
                    <Trash2 />
                    {getActionConfig(action, status).label}…
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {ordering && <JobPanel job={ordering} title="正在安排学习顺序" actions={{ stop: true }} />}

      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-3">
        {/* 今天 */}
        <Card className="gap-3 p-5">
          <h2 className="text-sm font-medium">今天</h2>
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1 space-y-1 text-sm">
              {!canPractice ? (
                <p className="text-muted-foreground">{notPracticeText}</p>
              ) : todayLines.length > 0 ? (
                todayLines.map((line, i) => <p key={i}>{line}</p>)
              ) : (
                <p className="text-muted-foreground">今天没有要学的{nextText ? `，${nextText}` : ''}</p>
              )}
              {canPractice && todayLines.length > 0 && !hasTodayWork && nextText && <p className="text-xs text-muted-foreground">{nextText}</p>}
            </div>
            {canPractice && (hasTodayWork || withWords) && (
              <Button onClick={startPractice} variant={hasTodayWork ? 'default' : 'outline'} disabled={!!ordering} title={ordering ? '学习顺序排好后就能开始' : undefined}>
                {hasTodayWork ? <Play /> : <RotateCw />}
                {!hasTodayWork ? '再练一次' : status === 'Pending' ? '开始学习' : '继续学习'}
              </Button>
            )}
          </div>
        </Card>

        {/* 进度 */}
        <Card className="gap-3 p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="inline-flex items-center gap-1 text-sm font-medium">
              进度
              <Tooltip>
                <TooltipTrigger aria-label="进度的口径">
                  <Info className="size-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="max-w-64">
                  {!withWords ? '完成的短文 / 全部短文' : '练过的单词 / 全部单词。复习时隔 7 天还能写对，算已掌握'}
                </TooltipContent>
              </Tooltip>
            </h2>
            <span className="text-xl font-semibold text-primary tabular-nums">{Math.round(learnProgress)}%</span>
          </div>
          <PlanProgressBar learnProgress={learnProgress} timeProgress={timeProgress} status={status} className="h-2" />
          {withWords && memory && memoryTotal > 0 && (
            <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-label="单词掌握情况">
              {memorySegments.map((seg) =>
                seg.count > 0 ? (
                  <Tooltip key={seg.label}>
                    <TooltipTrigger asChild>
                      <div className={seg.className} style={{ width: `${(seg.count / memoryTotal) * 100}%` }} />
                    </TooltipTrigger>
                    <TooltipContent>
                      {seg.label} {seg.count} 个
                    </TooltipContent>
                  </Tooltip>
                ) : null
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {withWords && memory && memorySegments.map((seg) => (
              <span key={seg.label} className="inline-flex items-center gap-1">
                <span className={cn('size-2 rounded-full', seg.className)} />
                {seg.label} <span className="text-foreground tabular-nums">{seg.count}</span>
              </span>
            ))}
            {withPassages && (
              <span>
                短文 <span className="text-foreground tabular-nums">{plan.completed_passages} / {plan.total_passages}</span> 篇
              </span>
            )}
            {withWords && (statistics?.learned_words ?? 0) > 0 && (
              <span>
                一次答对率 <span className="text-foreground tabular-nums">{Math.round(statistics?.average_accuracy_rate || 0)}%</span>
              </span>
            )}
            {(statistics?.streak_days ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1">
                <Flame className="size-3" />
                连续学习 <span className="text-foreground tabular-nums">{statistics?.streak_days}</span> 天
              </span>
            )}
          </div>
        </Card>
      </div>

      <Tabs value={view ?? 'schedule'} onValueChange={(v) => setView(v as ViewMode)} className="gap-4">
        <div className="flex items-center justify-between gap-3">
          <TabsList>
            {tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="gap-1.5 px-3">
                {t.label}
                {t.count !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{t.count}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
          {view === 'schedule' && withWords && (
            <ToggleGroup type="single" value={scheduleAs} onValueChange={(v) => v && setScheduleAs(v as 'list' | 'calendar')} className="rounded-lg bg-muted p-0.5" aria-label="日程显示方式">
              <ToggleGroupItem value="list" className="h-7 rounded-md px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm">
                <List />
                列表
              </ToggleGroupItem>
              <ToggleGroupItem value="calendar" className="h-7 rounded-md px-3 data-[state=on]:bg-background data-[state=on]:shadow-sm">
                <CalendarDays />
                日历
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>
        <TabsContent value="passages">
          <PlanPassagesView
            items={passageItems}
            loading={passagesLoading}
            intervalDays={plan.passage_interval_days}
            canPractice={canPractice}
            onOpen={(item) => onNavigate?.('passage-detail', { passageId: item.passageId, fromPlan: { planId: plan.id, planName: plan.name } })}
            onPractice={practicePassage}
            onMarkRead={markPassageRead}
            onAddPassages={() => setView('settings')}
          />
        </TabsContent>
        <TabsContent value="settings">
          <PlanSettingsView plan={plan} onChanged={loadAll} ordering={!!ordering} />
        </TabsContent>
        <TabsContent value="schedule">
          {withWords && scheduleAs === 'list' ? (
            <PlanScheduleView
              schedules={schedules}
              loading={schedulesLoading}
              sessions={sessions ?? []}
              today={today}
              canPractice={canPractice && !ordering}
              onStartPractice={(scheduleId) => onNavigate?.('word-practice', { planId: plan.id, scheduleId })}
            />
          ) : (
            <PlanOverviewView planId={plan.id} />
          )}
        </TabsContent>
        <TabsContent value="words">
          <PlanWordsView
            planWords={planWords}
            loading={wordsLoading}
            today={today}
            speakWord={(word) => audioPlayer.speak(word)}
            onRemoveWords={
              ['Draft', 'Pending', 'Active', 'Paused'].includes(status)
                ? async (wordIds) => {
                    const result = await studyService.batchRemoveWordsFromPlan(plan.id, wordIds);
                    if (!result.success) return result.error;
                    toast.showSuccess(`已从计划移除 ${wordIds.length} 个单词`);
                    await loadAll();
                    return null;
                  }
                : undefined
            }
          />
        </TabsContent>
        <TabsContent value="statistics" className="flex flex-col gap-6">
          <PlanStatisticsView statistics={statistics} planWords={planWords} partOfSpeechStats={posStats} />
          <section className="space-y-3">
            <h3 className="text-base font-semibold">练习记录</h3>
            <PlanLogsView practiceSessions={sessions ?? []} loading={sessionsLoading || sessions === null} onNavigate={onNavigate} canPractice={canPractice} />
          </section>
        </TabsContent>
      </Tabs>

      <AlertDialog open={pendingAction !== null} onOpenChange={(open) => {
          if (open || processing) return;
          setPendingAction(null);
          setActionError(null);
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          {actionError && <InlineError title={`无法${actionError.label}`}>{actionError.message}</InlineError>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={processing}>取消</AlertDialogCancel>
            <Button
              variant={confirm?.destructive ? 'destructive' : 'default'}
              onClick={() => pendingAction && runAction(pendingAction)}
              disabled={processing}
            >
              {processing && <Loader2 className="animate-spin" />}
              {pendingAction ? getActionConfig(pendingAction, status).label : ''}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
