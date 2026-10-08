import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CircleCheckBig, FileText, Flame, Info, Pause, Loader2, MoreHorizontal, Play, Target, Trash2 } from 'lucide-react';
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
import { MetricCard } from '@/components/MetricCard/MetricCard';
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
import { MEMORY_INTERVAL_DAYS } from '@/utils/memoryLevel';
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

type ViewMode = 'overview' | 'schedule' | 'words' | 'passages' | 'statistics' | 'logs' | 'settings';

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
    title: '终止学习这个计划？',
    description: '终止后不能再练习，练习记录会保留',
    destructive: true,
  },
  delete: {
    title: '删除这个计划？',
    description: '计划和全部练习记录会被删除，不能恢复，单词本不受影响',
    destructive: true,
  },
  complete: {
    title: '标记这个计划为已完成？',
    description: '标记后不能再练习，练习记录会保留',
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
  complete: ['已标记为完成'],
  terminate: ['已终止学习'],
  restart: ['已重新开始'],
  publish: ['已发布计划'],
  delete: ['已删除计划'],
};

/** 记忆等级：复习间隔与配色（等级 ≥ 4 为掌握） */
const BOX_CLASS = ['bg-chart-1/30', 'bg-chart-1/55', 'bg-chart-1/80', 'bg-chart-2/80', 'bg-chart-2'];
const BOX_META: Record<number, { label: string; className: string }> = Object.fromEntries(
  MEMORY_INTERVAL_DAYS.map((days, i) => [i + 1, { label: `${days} 天`, className: BOX_CLASS[i] }])
);

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<StudyPlanAction | null>(null);
  const [processing, setProcessing] = useState(false);
  /** 确认框里的操作失败原因（关闭确认框 / 换操作时清空） */
  const [actionError, setActionError] = useState<{ label: string; message: string } | null>(null);

  usePageTitle(plan?.name);

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

  // 默认页签：只练短文的计划看短文，其余看日程
  const contentKind = plan?.practice_content;
  useEffect(() => {
    if (contentKind && view === null) setView(contentKind === 'passages' ? 'passages' : 'schedule');
  }, [contentKind, view]);

  // 日程用时与学习日志都需要练习会话：切到这两个视图时加载一次
  useEffect(() => {
    if ((view === 'logs' || view === 'schedule') && sessions === null && !sessionsLoading) loadSessions();
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
      toast.showError('无法标记为读完', result.error);
      return;
    }
    toast.showSuccess(`已读完「${item.title}」`);
    await loadAll();
  };

  const duePassages = passageItems.filter((p) => p.status === 'due' || p.status === 'overdue');

  const startPractice = async () => {
    if (!plan) return;
    if (plan.practice_content === 'passages') {
      setView('passages');
      return;
    }
    const result = await studyService.getStudyPlanSchedules(plan.id);
    if (!result.success) {
      toast.showError('无法开始练习', result.error);
      return;
    }
    if (result.data.length === 0) {
      toast.showInfo('这个计划还没有日程', '在「设置」页签追加单词本');
      return;
    }
    // 统一规则：今天未练完 → 最早逾期 → 今天（再练）→ 第一个未练完
    const target = pickPracticeSchedule(result.data);
    if (target) onNavigate?.('word-practice', { planId: plan.id, scheduleId: target.id });
    else if (duePassages.length > 0) {
      toast.showInfo('单词日程都练完了');
      setView('passages');
    } else toast.showInfo('日程都已练完', '可以在「日程」页签再练一次');
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
  // 待开始 / 进行中都能直接练习（待开始的计划第一次练习时自动开始），不再单独显示「开始学习」
  const canPractice = status === 'Pending' || status === 'Active';
  const { primary, menu, danger } = groupPlanActions(getAvailableActions(status), status);
  const timeProgress = calculateTimeProgress(plan.start_date, plan.end_date);
  const learnProgress = plan.practice_content === 'passages'
    ? (plan.total_passages > 0 ? (plan.completed_passages / plan.total_passages) * 100 : 0)
    : (statistics?.actual_progress_percentage ?? 0);
  const withWords = plan.practice_content !== 'passages';
  const withPassages = plan.practice_content !== 'words';
  const meta = [
    withWords && plan.daily_new_words ? `每天 ${plan.daily_new_words} 个新词` : null,
    withWords ? `周期 ${plan.study_period_days || 0} 天` : null,
    plan.start_date || plan.end_date ? `${formatDate(plan.start_date) || '—'} – ${formatDate(plan.end_date) || '—'}` : null,
    withWords ? `${plan.total_words} 个单词` : null,
    withPassages ? `${plan.total_passages} 篇短文` : null,
  ].filter(Boolean).join(' · ');
  const nextPassage = passageItems.find((p) => p.status !== 'completed');
  const passageProgress = plan.total_passages > 0 ? (plan.completed_passages / plan.total_passages) * 100 : 0;
  const memoryTotal = memory?.total || 0;

  return (
    <div className={container}>
      {/* 页头 */}
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
          {canPractice && (
            <Button onClick={startPractice}>
              <Play />
              {status === 'Pending' ? '开始练习' : '进入练习'}
            </Button>
          )}
          {primary.map((action, i) => (
            <Button key={action} variant={!canPractice && i === 0 ? 'default' : 'outline'} onClick={() => handleAction(action)}>
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

      {/* 进度与记忆等级 */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="gap-4 p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="inline-flex items-center gap-1 text-sm font-medium">
              学习进度
              <Tooltip>
                <TooltipTrigger aria-label="学习进度的口径">
                  <Info className="size-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="max-w-64">
                  {!withWords ? '完成的短文 / 全部短文' : '已掌握的单词 / 全部单词；掌握 = 间隔 7 天后仍能写对'}
                </TooltipContent>
              </Tooltip>
            </h2>
            <span className="text-2xl font-semibold text-primary tabular-nums">{Math.round(learnProgress)}%</span>
          </div>
          <PlanProgressBar learnProgress={learnProgress} timeProgress={timeProgress} status={status} className="h-2" />
          {withWords && withPassages && (
            <p className="text-xs text-muted-foreground tabular-nums">
              短文 {plan.completed_passages} / {plan.total_passages} 篇
            </p>
          )}
        </Card>
        {!withWords ? (
          <Card className="gap-3 p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-medium">短文</h2>
              <span className="text-xs text-muted-foreground">{intervalLabel(plan.passage_interval_days)}</span>
            </div>
            {nextPassage ? (
              <div className="flex items-center gap-3">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{nextPassage.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {nextPassage.status === 'overdue' ? (
                      <span className="text-warning">已逾期（{formatDate(nextPassage.scheduledDate)}）</span>
                    ) : nextPassage.status === 'due' ? (
                      '今天要读'
                    ) : (
                      `下一篇 ${formatDate(nextPassage.scheduledDate)}`
                    )}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => setView('passages')}>
                  查看
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{passageItems.length > 0 ? '短文都已完成' : '计划里还没有短文'}</p>
            )}
          </Card>
        ) : (
          <Card className="gap-3 p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-medium">记忆等级</h2>
              {memory && (
                <span className="text-xs text-muted-foreground">
                  {memory.due_today > 0 ? (
                    <span className="font-medium text-warning">今天待复习 {memory.due_today} 个</span>
                  ) : memory.next_due_date ? (
                    `下次复习 ${formatDate(memory.next_due_date)}`
                  ) : (
                    '暂无待复习'
                  )}
                </span>
              )}
            </div>
            {memory && memoryTotal > 0 ? (
              <>
                <div className="flex h-3 overflow-hidden rounded-full bg-muted" aria-label="记忆等级分布">
                  {memory.box_counts.map((b) =>
                    b.count > 0 ? (
                      <Tooltip key={b.box_level}>
                        <TooltipTrigger asChild>
                          <div className={BOX_META[b.box_level]?.className} style={{ width: `${(b.count / memoryTotal) * 100}%` }} />
                        </TooltipTrigger>
                        <TooltipContent>
                          等级 {b.box_level}（{BOX_META[b.box_level]?.label}后复习）：{b.count} 个
                        </TooltipContent>
                      </Tooltip>
                    ) : null
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>未学 <span className="text-foreground tabular-nums">{memory.not_started}</span></span>
                  <span>学习中 <span className="text-foreground tabular-nums">{memory.learned - memory.mastered}</span></span>
                  <span>已掌握 <span className="font-medium text-foreground tabular-nums">{memory.mastered}</span></span>
                  <span className="ml-auto">
                    {memory.box_counts.map((b) => (
                      <span key={b.box_level} className="ml-2 inline-flex items-center gap-1">
                        <span className={cn('size-2 rounded-full', BOX_META[b.box_level]?.className)} />
                        {b.box_level}
                      </span>
                    ))}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{memory ? '还没有开始学习' : '加载中…'}</p>
            )}
          </Card>
        )}
      </div>

      {/* 关键指标（总单词数、已掌握在页头与记忆等级卡里，不重复） */}
      <section aria-label="关键指标" className="grid grid-cols-3 gap-3">
        {withWords ? (
          <MetricCard
            label="今日任务"
            value={todaySchedule?.word_count ?? 0}
            unit="个单词"
            icon={CalendarCheck}
            hint={
              [
                !todaySchedule
                  ? canPractice
                    ? '今天没有任务'
                    : '计划不在进行中'
                  : todaySchedule.completed
                    ? '今天已练完'
                    : `新学 ${todaySchedule.new_words_count} · 复习 ${todaySchedule.review_words_count}`,
                withPassages && duePassages.length > 0 ? `短文 ${duePassages.length} 篇` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            }
          />
        ) : (
          <MetricCard
            label="今日任务"
            value={duePassages.length}
            unit="篇短文"
            icon={CalendarCheck}
            hint={duePassages.some((p) => p.status === 'overdue') ? '含逾期' : !canPractice ? '计划不在进行中' : undefined}
          />
        )}
        {withWords ? (
          <MetricCard label="首次作答正确率" value={Math.round(statistics?.average_accuracy_rate || 0)} unit="%" icon={Target} tip="每题第一次作答，不含改正后的重考" />
        ) : (
          <MetricCard label="短文进度" value={Math.round(passageProgress)} unit="%" icon={Target} hint={`已完成 ${plan.completed_passages} / ${plan.total_passages} 篇`} />
        )}
        <MetricCard label="连续学习" value={statistics?.streak_days || 0} unit="天" icon={Flame} />
      </section>

      <Tabs value={view ?? 'schedule'} onValueChange={(v) => setView(v as ViewMode)} className="gap-4">
        <TabsList>
          {withWords && <TabsTrigger value="schedule" className="px-3">日程安排</TabsTrigger>}
          {withWords && (
            <TabsTrigger value="words" className="gap-1.5 px-3">
              单词<span className="text-xs text-muted-foreground tabular-nums">{planWords.length}</span>
            </TabsTrigger>
          )}
          {withPassages && (
            <TabsTrigger value="passages" className="gap-1.5 px-3">
              短文<span className="text-xs text-muted-foreground tabular-nums">{plan.total_passages}</span>
            </TabsTrigger>
          )}
          <TabsTrigger value="overview" className="px-3">日历</TabsTrigger>
          {withWords && <TabsTrigger value="statistics" className="px-3">统计分析</TabsTrigger>}
          {withWords && <TabsTrigger value="logs" className="px-3">学习日志</TabsTrigger>}
          <TabsTrigger value="settings" className="px-3">设置</TabsTrigger>
        </TabsList>
        <TabsContent value="passages">
          <PlanPassagesView
            items={passageItems}
            loading={passagesLoading}
            intervalDays={plan.passage_interval_days}
            canPractice={canPractice}
            onOpen={(item) => onNavigate?.('passage-detail', { passageId: item.passageId, fromPlan: { planId: plan.id, planName: plan.name } })}
            onPractice={practicePassage}
            onMarkRead={markPassageRead}
          />
        </TabsContent>
        <TabsContent value="settings">
          <PlanSettingsView plan={plan} onChanged={loadAll} onDelete={() => handleAction('delete')} />
        </TabsContent>
        <TabsContent value="overview">
          <PlanOverviewView planId={plan.id} />
        </TabsContent>
        <TabsContent value="schedule">
          <PlanScheduleView
            schedules={schedules}
            loading={schedulesLoading}
            sessions={sessions ?? []}
            today={today}
            canPractice={canPractice}
            onStartPractice={(scheduleId) => onNavigate?.('word-practice', { planId: plan.id, scheduleId })}
          />
        </TabsContent>
        <TabsContent value="words">
          <PlanWordsView
            planWords={planWords}
            loading={wordsLoading}
            today={today}
            onPlayWord={(word) => audioPlayer.playWord(word)}
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
        <TabsContent value="statistics">
          <PlanStatisticsView statistics={statistics} planWords={planWords} partOfSpeechStats={posStats} />
        </TabsContent>
        <TabsContent value="logs">
          <PlanLogsView practiceSessions={sessions ?? []} loading={sessionsLoading || sessions === null} onNavigate={onNavigate} canPractice={canPractice} />
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
