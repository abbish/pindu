import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, BookOpenCheck, FileQuestion, Headphones, ListChecks, Loader2, MoreHorizontal, Pencil, Play, Sparkles, Trash2, WandSparkles, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { PageError } from '@/components/PageError';
import { InlineError } from '@/components/InlineError';
import { QuestionSetDialog } from '@/components/QuestionSetDialog';
import { TargetWordsPanel } from './passage-detail/TargetWordsPanel';
import { ReadAloudPanel } from './passage-detail/ReadAloudPanel';
import { ClipStudyPanel } from './passage-detail/ClipStudyPanel';
import { videoService } from '@/services/videoService';
import { MaterialEditDialog } from '@/components/MaterialEditDialog';
import { TagChips } from '@/components/MaterialToolbar/MaterialToolbar';
import { useJobs, useOnJobFinished } from '@/hooks/useJobs';
import { STOPPING_STAGE, jobPercent } from '@/components/Jobs';
import { isJobActive, type Job } from '@/types/job';
import { useElapsed } from '@/hooks/useElapsed';
import { jobService } from '@/services/jobService';
import { Progress } from '@/components/ui/progress';
import { jobErrorText } from '@/components/Jobs';
import type { PassageVideo } from '@/types/video';
import { NewWordsCard } from './passage-detail/NewWordsCard';
import { RepickTargetWordsDialog } from './passage-detail/RepickTargetWordsDialog';
import { usePageTitle } from '@/components/AppShell/pageTitle';
import { useToast } from '@/components/Toast/ToastContainer';
import { cn } from '@/lib/utils';
import { passageService } from '@/services/passageService';
import { studyService } from '@/services/studyService';
import { formatDate, formatDuration, formatRelative } from '@/utils/datetime';
import { LEVEL_LABEL, specSummary } from '@/utils/passage';
import type { Passage, PassageMode, PlanPassage, QuestionSetSummary, QuestionSetSpec } from '@/types/passage';
import type { NavigateFn, PassageDetailTab, PassagePracticeReturn, PlanContext } from '../navigation';
import { PASSAGE_STATUS, taskLabel } from '@/components/PlanPassagePicker';

export interface PassageDetailPageProps {
  passageId?: number;
  /** 从计划的短文任务打开：显示这项任务（读完了 / 开始练习），返回与删除后回到计划 */
  fromPlan?: PlanContext;
  /** 读完 / 返回回到哪里（默认这个计划的短文页签） */
  returnTo?: PassagePracticeReturn;
  /** 从视频库打开的片段（加载前就按片段显示返回与删除） */
  clip?: boolean;
  onNavigate?: NavigateFn;
  /** 打开时的页签 */
  tab?: PassageDetailTab;
}

const container = 'mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-8 py-7';
/** 侧栏的目标词：点开看单词卡；悬停时右侧出现移除 */
const TargetChip: React.FC<{ word: string; meaning?: string | null; className?: string; onOpen: () => void; onRemove?: () => void }> = ({ word, meaning, className, onOpen, onRemove }) => (
  <span className={cn('group inline-flex items-center rounded-full text-xs hover:ring-1 hover:ring-primary/40', className)}>
    <button type="button" onClick={onOpen} className="rounded-full py-0.5 pl-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" title={meaning ?? undefined}>
      {word}
      {meaning && <span className="text-muted-foreground"> {meaning}</span>}
    </button>
    {onRemove && (
      <button type="button" onClick={onRemove} aria-label={`移除 ${word}`} className="ml-0.5 rounded-full p-0.5 pr-1.5 text-muted-foreground opacity-0 outline-none group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100">
      <X className="size-3" />
    </button>
    )}
  </span>
);

/** 题组卡片的外框与左侧图标（已生成的题组与生成中的共用，生成中的图标转圈） */
const SetCard: React.FC<{ mode: PassageMode; busy?: boolean; children: React.ReactNode }> = ({ mode, busy, children }) => (
  <Card className="flex-row items-center gap-4 px-5 py-4">
    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
      {busy ? <Loader2 className="size-5 animate-spin text-primary" /> : mode === 'listening' ? <Headphones className="size-5" /> : <FileQuestion className="size-5" />}
    </div>
    {children}
  </Card>
);

/** 题组：名称、题型与难度；开始练习；⋯ 改名 / 删除。素材里的题组是题库，不显示练没练（练习跟踪在学习计划里） */
const QuestionSetRow: React.FC<{ set: QuestionSetSummary; onStart: () => void; onRename: () => void; onDelete: () => void }> = ({ set, onStart, onRename, onDelete }) => (
  <SetCard mode={set.mode}>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="font-semibold">{set.name}</span>
        <span className="text-xs text-muted-foreground">{formatRelative(set.createdAt)}</span>
      </div>
      <div className="mt-0.5 truncate text-sm text-muted-foreground">{specSummary(set.spec)}</div>
    </div>
    <Button variant="outline" onClick={onStart}>
      {set.mode === 'listening' ? <Headphones /> : <BookOpen />}
      开始练习
    </Button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="更多操作">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onRename}>
          <Pencil />
          改名…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 />
          删除题组…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </SetCard>
);

/** 生成中的题组：和题组同样的卡片（名称、题型与难度在提交时就定了），右侧换成进度与停止 */
const PendingSetRow: React.FC<{ job: Job; mode: PassageMode }> = ({ job, mode }) => {
  const detail = job.detail as { name?: string | null; spec?: QuestionSetSpec } | null;
  const [stopping, setStopping] = useState(false);
  const elapsed = useElapsed(job.startedAt, true);
  const status = stopping || job.stage === STOPPING_STAGE ? STOPPING_STAGE : job.status === 'queued' ? '排队中' : `正在出题${elapsed !== null ? ` · 已用 ${formatDuration(elapsed * 1000)}` : ''}`;
  const stop = async () => {
    setStopping(true);
    if (!(await jobService.cancel(job.id)).success) setStopping(false);
  };
  return (
    <SetCard mode={mode} busy>
      <div className="min-w-0 flex-1" role="status">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{detail?.name || '新题组'}</span>
          <span className="text-xs text-muted-foreground">{status}</span>
        </div>
        {detail?.spec && <div className="mt-0.5 truncate text-sm text-muted-foreground">{specSummary(detail.spec)}</div>}
        <Progress value={jobPercent(job)} className="mt-2 h-1.5 w-full max-w-sm [&>[data-slot=progress-indicator]]:bg-brand" aria-label="生成进度" />
      </div>
      <Button variant="outline" onClick={stop} disabled={stopping}>
        停止
      </Button>
    </SetCard>
  );
};

/**
 * 短文详情：「原文」页签自由阅读（显示翻译、标出目标词、全文 / 逐句朗读）+ 侧栏（目标词、来源、场景）；
 * 「阅读理解」页签管理题组（生成、删除、阅读 / 听力练习）。
 */
export const PassageDetailPage: React.FC<PassageDetailPageProps> = ({ passageId, fromPlan, returnTo, clip: openedAsClip, tab: initialTab, onNavigate }) => {
  const toast = useToast();
  const [passage, setPassage] = useState<Passage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>(fromPlan && (initialTab === 'sets' || initialTab === 'listening') ? 'text' : (initialTab ?? 'text'));
  const [focusWord, setFocusWord] = useState<string | null>(null);
  /** 正在给这篇出题的后台任务（全局任务列表里取：可以同时生成几套，离开再回来也接得上；这个页面开着时由页面提示结果） */
  const jobs = useJobs();
  /** 这种方式（阅读 / 听力）正在生成的题组，按提交顺序 */
  const generatingSets = (mode: PassageMode) =>
    jobs.filter((j) => {
      const params = j.link?.params as { passageId?: number; mode?: PassageMode } | undefined;
      return j.kind === 'question_set' && isJobActive(j) && params?.passageId === passageId && (params?.mode ?? 'reading') === mode;
    });
  useOnJobFinished((job) => {
    if (job.kind !== 'question_set' || (job.link?.params as { passageId?: number } | null)?.passageId !== passageId) return;
    if (job.status === 'succeeded') {
      const r = job.result as { name?: string; count?: number } | null;
      toast.showSuccess(`已生成「${r?.name ?? '题组'}」`, `共 ${r?.count ?? 0} 题`);
      load();
    } else if (job.status === 'failed') {
      toast.showError('无法生成题组', jobErrorText(job));
    }
  });
  /** 视频短片：有就默认打开「视频」页签 */
  const [clip, setClip] = useState<PassageVideo | null>(null);
  /** 视频片段：返回、删除都按片段说，删完回视频库 */
  const isClip = Boolean(openedAsClip) || passage?.origin === 'video';
  /** 从学习计划进来：是在学、完成计划任务，不在这里准备或改动素材（不生成题组、不编辑、不改词汇与译文） */
  const studying = Boolean(fromPlan);
  const [showGenerate, setShowGenerate] = useState(false);
  /** 生成题组弹窗打开时选中的方式 */
  const [generateMode, setGenerateMode] = useState<PassageMode>('reading');
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** 「编辑…」：标题、难度、场景描述、标签 */
  const [editing, setEditing] = useState(false);
  const [repicking, setRepicking] = useState(false);
  /** 待确认移除的词 */
  const [removing, setRemoving] = useState<string | null>(null);
  const [setToDelete, setSetToDelete] = useState<QuestionSetSummary | null>(null);
  /** 改名中的题组与输入框里的名称；renameError：保存失败的原因（留在弹窗里） */
  const [renamingSet, setRenamingSet] = useState<{ set: QuestionSetSummary; name: string } | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  usePageTitle(passage?.title);

  // 从计划打开：这篇短文在计划里的任务（状态以后端为准）
  const [planTask, setPlanTask] = useState<PlanPassage | null>(null);
  const [planActive, setPlanActive] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const fromPlanId = fromPlan?.planId;
  useEffect(() => {
    if (!fromPlanId || !passageId) return;
    let stale = false;
    Promise.all([passageService.getPlanPassages(fromPlanId), studyService.getStudyPlan(fromPlanId)]).then(([items, plan]) => {
      if (stale) return;
      if (items.success) setPlanTask(items.data.find((p) => p.passageId === passageId) ?? null);
      // 计划暂停 / 结束后不能在计划里练习：任务条只显示状态，不给操作
      if (plan.success) setPlanActive(plan.data.unified_status === 'Pending' || plan.data.unified_status === 'Active');
    });
    return () => {
      stale = true;
    };
  }, [fromPlanId, passageId]);
  /** 回到进来的地方：首页 / 日历，或这个计划的短文页签 */
  const backToPlan = () => {
    if (returnTo === 'home') onNavigate?.('home');
    else if (returnTo === 'calendar') onNavigate?.('calendar');
    else if (fromPlan) onNavigate?.('plan-detail', { planId: fromPlan.planId, tab: 'passages' });
  };

  const markRead = async () => {
    if (!fromPlan || !passageId) return;
    setMarkingRead(true);
    const result = await passageService.completePlanPassageReading(fromPlan.planId, passageId);
    setMarkingRead(false);
    if (!result.success) {
      toast.showError('无法标记为已完成', result.error);
      return;
    }
    toast.showSuccess(`已完成「${planTask?.title ?? passage?.title ?? '短文'}」`);
    backToPlan();
  };

  const load = useCallback(async () => {
    if (!passageId) return setError('缺少短文');
    setError(null);
    const result = await passageService.getPassage(passageId);
    if (result.success) setPassage(result.data);
    else setError(result.error);
  }, [passageId]);

  useEffect(() => {
    load();
  }, [load]);


  useEffect(() => {
    if (!passageId) return;
    let stale = false;
    videoService.getPassageVideo(passageId).then((r) => {
      if (stale || !r.success || !r.data) return;
      setClip(r.data);
      // 视频片段默认看视频；指定了页签（如练完回来）时不改
      if (!initialTab) setTab('video');
    });
    return () => {
      stale = true;
    };
  }, [passageId]);

  const startPractice = (setId: number, mode: PassageMode) => {
    onNavigate?.('passage-practice', { setId, mode });
  };

  const removePassage = async () => {
    if (!passage) return;
    const result = await passageService.deletePassage(passage.id);
    setConfirmDelete(false);
    if (result.success) {
      toast.showSuccess(isClip ? '已删除场景片段' : '已删除短文');
      if (fromPlan) backToPlan();
      else if (isClip) onNavigate?.('videos', { tab: 'clips' });
      else onNavigate?.('passages');
    } else {
      toast.showError(isClip ? '无法删除场景片段' : '无法删除短文', result.error);
    }
  };

  const renameSet = async () => {
    if (!renamingSet) return;
    if (renamingSet.name.trim() === renamingSet.set.name) return setRenamingSet(null);
    const result = await passageService.renameQuestionSet(renamingSet.set.id, renamingSet.name);
    if (!result.success) return setRenameError(result.error);
    setRenamingSet(null);
    load();
  };

  const removeSet = async () => {
    if (!setToDelete) return;
    const result = await passageService.deleteQuestionSet(setToDelete.id);
    setSetToDelete(null);
    if (result.success) {
      toast.showSuccess('已删除题组');
      load();
    } else {
      toast.showError('无法删除题组', result.error);
    }
  };

  if (error) {
    return (
      <div className={container}>
        <PageError title="无法打开短文" message={error} onRetry={load} back={fromPlan ? { label: returnTo === 'home' ? '返回首页' : returnTo === 'calendar' ? '返回日历' : '返回计划', onClick: backToPlan } : openedAsClip ? { label: '返回视频库', onClick: () => onNavigate?.('videos', { tab: 'clips' }) } : { label: '返回短文库', onClick: () => onNavigate?.('passages') }} />
      </div>
    );
  }
  if (!passage) {
    return (
      <div className={container}>
        <Skeleton className="h-14 w-96" />
        <Skeleton className="h-9 w-56" />
        <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-6">
          <Skeleton className="h-[480px] rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  // 导入的材料：指定单词（required）/ 重点词；AI 生成的短文：指定单词 / AI 选词
  // 视频切片与导入的材料一样：原文不是 AI 生成的，重点词由 AI 识别，可以把未收录词加进词汇本
  const imported = passage.origin !== 'generated';
  const required = passage.targetWords.filter((w) => w.required);
  const picked = passage.targetWords.filter((w) => !w.required);
  /** 有还没收录进词汇本的目标词 */
  const hasNewWords = passage.targetWords.some((w) => w.wordId === null);
  /** 读原文时选中的词加成目标词，然后到「目标词」页签看它的单词卡（没收录的会自动生成）；
   * `stay`：留在当前页签（从句子分析面板加入时不打断精读） */
  const addTarget = async (word: string, stay = false, form?: string) => {
    const result = await passageService.addTargetWord(passage.id, word, form);
    if (!result.success) {
      toast.showError('无法加入词汇', result.error);
      return;
    }
    setPassage(result.data);
    toast.showSuccess(`已加入词汇「${result.data.targetWords[result.data.targetWords.length - 1]?.word ?? word}」`);
    if (!stay) openWord(result.data.targetWords[result.data.targetWords.length - 1]?.word ?? word);
  };
  /** 侧栏点目标词：到「目标词」页签看这个词的单词卡 */
  const openWord = (word: string) => {
    setFocusWord(word);
    setTab('words');
  };
  /** 这种方式（阅读 / 听力）的题组 */
  const setsOf = (mode: PassageMode) => passage.questionSets.filter((s) => s.mode === mode);
  const openGenerate = (mode: PassageMode) => {
    setGenerateMode(mode);
    setShowGenerate(true);
  };
  const removeTarget = async (word: string) => {
    setRemoving(null);
    const result = await passageService.removeTargetWord(passage.id, word);
    if (!result.success) {
      toast.showError('无法移除', result.error);
      return;
    }
    setPassage(result.data);
    toast.showSuccess(`已移除「${word}」`);
  };
  /** 改一句的译文；失败时返回原因（留在编辑框里显示） */
  const editTranslation = async (index: number, zh: string): Promise<string | null> => {
    const result = await passageService.updateTranslation(passage.id, index, zh);
    if (!result.success) return result.error;
    setPassage(result.data);
    return null;
  };

  return (
    <div className={container}>
      {/* 头部：标题 / 水平 / 词数 / 时间 + 主操作（生成题组）+ ⋯ */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight select-text">{passage.title}</h1>
            <Badge variant="secondary">{LEVEL_LABEL[passage.level] ?? passage.level}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {passage.origin === 'imported' && `导入${passage.sourceLabel ? `（${passage.sourceLabel}）` : ''} · `}
            {passage.origin === 'video' && `视频${passage.sourceLabel ? `（${passage.sourceLabel}）` : ''} · `}
            {passage.wordCount} 词 · {passage.sentences.length} 句 · {passage.origin === 'generated' ? '创建于' : '导入于'} {formatDate(passage.createdAt)}
          </p>
          {passage.scene && <p className="text-sm text-muted-foreground select-text">{passage.scene}</p>}
          {passage.tags.length > 0 && <TagChips tags={passage.tags} />}
        </div>
        {!studying && (
        <div className="flex shrink-0 gap-2">
          <Button onClick={() => openGenerate(tab === 'listening' ? 'listening' : 'reading')}>
            <Sparkles />
            生成题组
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="更多操作">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <Pencil />
                编辑…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRepicking(true)}>
                <WandSparkles />
                重新挑选词汇…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                <Trash2 />
                {isClip ? '删除场景片段…' : '删除短文…'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        )}
      </div>

      {/* 从计划打开：这篇短文在计划里的任务 */}
      {fromPlan && planTask && (
        <Card className="flex-row items-center gap-3 px-5 py-3">
          <ListChecks className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 text-sm">
            <span className="font-medium">{fromPlan.planName}</span>
            <span className="text-muted-foreground">
              {' '}
              · {formatDate(planTask.scheduledDate)} · {taskLabel(planTask.setName, planTask.setId, planTask.mode, planTask.isVideo)}
            </span>
          </div>
          <Badge variant="outline" className={cn('border-transparent font-normal', PASSAGE_STATUS[planTask.status].className)}>
            {PASSAGE_STATUS[planTask.status].label}
          </Badge>
          {planActive && planTask.setId !== null && planTask.status !== 'upcoming' && (
            <Button
              size="sm"
              variant={planTask.status === 'completed' ? 'outline' : 'default'}
              onClick={() =>
                planTask.setId !== null &&
                onNavigate?.('passage-practice', { setId: planTask.setId, mode: planTask.mode, planId: fromPlan.planId, returnTo: returnTo ?? 'plan-detail' })
              }
            >
              <Play />
              {planTask.status === 'completed' ? '再练一次' : '开始练习'}
            </Button>
          )}
          {planActive && planTask.setId === null && (planTask.status === 'due' || planTask.status === 'overdue') && (
            <Button size="sm" onClick={markRead} disabled={markingRead}>
              {markingRead ? <Loader2 className="animate-spin" /> : <BookOpenCheck />}
              {planTask.isVideo ? '标记为已看' : '标记为已读'}
            </Button>
          )}
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList>
          {clip && (
            <TabsTrigger value="video" className="px-3">
              视频
            </TabsTrigger>
          )}
          <TabsTrigger value="text" className="px-3">
            原文
          </TabsTrigger>
          <TabsTrigger value="words" className="gap-1.5 px-3">
            词汇<span className="text-xs text-muted-foreground tabular-nums">{passage.targetWords.length}</span>
          </TabsTrigger>
          {/* 计划里练哪套题由任务定（任务卡上开始练习），不在这里挑题组 */}
          {!studying && (
            <>
          <TabsTrigger value="sets" className="gap-1.5 px-3">
            阅读理解<span className="text-xs text-muted-foreground tabular-nums">{setsOf('reading').length}</span>
          </TabsTrigger>
          <TabsTrigger value="listening" className="gap-1.5 px-3">
            听力练习<span className="text-xs text-muted-foreground tabular-nums">{setsOf('listening').length}</span>
          </TabsTrigger>
            </>
          )}
        </TabsList>

        {clip && (
          <TabsContent value="video">
            <ClipStudyPanel video={clip} sentences={passage.sentences} passage={passage} onAddTarget={studying ? undefined : addTarget} onOpenWord={openWord} onEditTranslation={studying ? undefined : editTranslation} onPractice={studying ? undefined : () => setTab('listening')} />
          </TabsContent>
        )}

        <TabsContent value="text">
          <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-6">
            <ReadAloudPanel passage={passage} onAddTarget={studying ? undefined : addTarget} onOpenWord={openWord} onEditTranslation={studying ? undefined : editTranslation} />

            <aside className="flex flex-col gap-4">
              <Card className="gap-3 px-5 py-4">
                <h2 className="text-sm font-semibold">词汇</h2>
                {passage.targetWords.length === 0 && <p className="text-xs text-muted-foreground">还没有词汇</p>}
                {required.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs text-muted-foreground">指定单词</div>
                    <div className="flex flex-wrap gap-1">
                      {required.map((w) => (
                        <TargetChip key={w.word} word={w.word} className="bg-accent text-accent-foreground" onOpen={() => openWord(w.word)} onRemove={studying ? undefined : () => setRemoving(w.word)} />
                      ))}
                    </div>
                  </div>
                )}
                {picked.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs text-muted-foreground">{imported ? '重点词' : 'AI 选词'}</div>
                    <div className="flex flex-wrap gap-1">
                      {picked.map((w) => (
                        <TargetChip key={w.word} word={w.word} meaning={w.meaning} className="bg-muted" onOpen={() => openWord(w.word)} onRemove={studying ? undefined : () => setRemoving(w.word)} />
                      ))}
                    </div>
                  </div>
                )}
              </Card>
              {hasNewWords && !studying && <NewWordsCard passageId={passage.id} sourceLabel={passage.sourceLabel} onAdded={load} onOpenBook={(id) => onNavigate?.('wordbook-detail', { id })} />}
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="words">
          {passage.targetWords.length === 0 ? (
            <EmptyState icon={<BookOpen />} title="还没有词汇">
              {!studying && (
                <Button onClick={() => setRepicking(true)}>
                  <WandSparkles />
                  挑选词汇
                </Button>
              )}
            </EmptyState>
          ) : (
          <TargetWordsPanel
            passage={passage}
            focusWord={focusWord}
            onRemove={studying ? undefined : setRemoving}
            onOpenPassage={(passageId, isClip) => onNavigate?.('passage-detail', { passageId, clip: isClip || undefined })}
            footer={hasNewWords && !studying && <NewWordsCard passageId={passage.id} sourceLabel={passage.sourceLabel ?? passage.title} onAdded={load} onOpenBook={(id) => onNavigate?.('wordbook-detail', { id })} />}
          />
          )}
        </TabsContent>

        {!studying && (['reading', 'listening'] as const).map((mode) => (
          <TabsContent key={mode} value={mode === 'reading' ? 'sets' : 'listening'}>
            {generatingSets(mode).length > 0 && (
              <div className="mb-3 flex flex-col gap-3">
                {generatingSets(mode).map((job) => (
                  <PendingSetRow key={job.id} job={job} mode={mode} />
                ))}
              </div>
            )}
            {setsOf(mode).length === 0 && generatingSets(mode).length === 0 ? (
              <EmptyState icon={mode === 'listening' ? <Headphones /> : <FileQuestion />} title={mode === 'listening' ? '还没有听力题组' : '还没有阅读理解题组'}>
                <Button onClick={() => openGenerate(mode)}>
                  <Sparkles />
                  生成题组
                </Button>
              </EmptyState>
            ) : (
              <div className="flex flex-col gap-3">
                {setsOf(mode).map((s) => (
                  <QuestionSetRow key={s.id} set={s} onStart={() => startPractice(s.id, mode)} onRename={() => (setRenameError(null), setRenamingSet({ set: s, name: s.name }))} onDelete={() => setSetToDelete(s)} />
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <QuestionSetDialog
        isOpen={showGenerate}
        onClose={() => setShowGenerate(false)}
        passageId={passage.id}
        level={passage.level}
        mode={generateMode}
        existingSets={{ reading: setsOf('reading').length + generatingSets('reading').length, listening: setsOf('listening').length + generatingSets('listening').length }}
        onStarted={(_jobId, mode) => {
          // 到生成的那一类题组的页签看进度
          setTab(mode === 'listening' ? 'listening' : 'sets');
        }}
      />

      <RepickTargetWordsDialog
        passage={passage}
        open={repicking}
        onOpenChange={setRepicking}
        onSaved={(p) => {
          setPassage(p);
          toast.showSuccess(`已换成 ${p.targetWords.length} 个词汇`);
        }}
      />

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>从这篇短文的词汇里移除「{removing}」？</AlertDialogTitle>
            <AlertDialogDescription>词汇本里的单词和学习记录不受影响。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => removing && void removeTarget(removing)}>移除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MaterialEditDialog
        target={editing ? { kind: 'passage', id: passage.id, title: passage.title, level: passage.level, scene: passage.scene, tags: passage.tags, isClip } : null}
        onClose={() => setEditing(false)}
        onSaved={() => void load()}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isClip ? '删除场景片段' : '删除短文'}「{passage.title}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isClip
                ? `将同时删除这个场景片段的视频、${passage.questionSets.length} 个题组与练习记录；原始视频不受影响。`
                : `将同时删除 ${passage.questionSets.length} 个题组与练习记录；词汇本与学习计划不受影响。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={removePassage}>
              {isClip ? '删除场景片段' : '删除短文'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={renamingSet !== null} onOpenChange={(o) => !o && setRenamingSet(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>改名</AlertDialogTitle>
          </AlertDialogHeader>
          <Input
            value={renamingSet?.name ?? ''}
            maxLength={30}
            onChange={(e) => {
              setRenameError(null);
              setRenamingSet((r) => (r ? { ...r, name: e.target.value } : r));
            }}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void renameSet()}
            aria-label="题组名称"
            autoFocus
          />
          {renameError && <InlineError title="无法改名">{renameError}</InlineError>}
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <Button onClick={() => void renameSet()} disabled={!renamingSet?.name.trim()}>
              保存
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={setToDelete !== null} onOpenChange={(open) => !open && setSetToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除题组「{setToDelete?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>将同时删除该题组的练习记录，短文不受影响。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={removeSet}>
              删除题组
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
