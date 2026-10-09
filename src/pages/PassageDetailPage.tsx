import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, BookOpenCheck, FileQuestion, Headphones, ListChecks, Loader2, MoreHorizontal, Play, Sparkles, Trash2 } from 'lucide-react';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { PageError } from '@/components/PageError';
import { SourceBadge } from '@/components/PassageList';
import { QuestionSetDialog } from '@/components/QuestionSetDialog';
import { TargetWordsPanel } from './passage-detail/TargetWordsPanel';
import { ReadAloudPanel } from './passage-detail/ReadAloudPanel';
import { ClipStudyPanel } from './passage-detail/ClipStudyPanel';
import { videoService } from '@/services/videoService';
import { MaterialTags } from '@/components/MaterialTags/MaterialTags';
import { useJob, useJobs, useOnJobFinished } from '@/hooks/useJobs';
import { JobPanel, activeJobFor } from '@/components/Jobs';
import { isJobActive } from '@/types/job';
import { jobErrorText } from '@/components/Jobs';
import type { PassageVideo } from '@/types/video';
import { NewWordsCard } from './passage-detail/NewWordsCard';
import { usePageTitle } from '@/components/AppShell/pageTitle';
import { useToast } from '@/components/Toast/ToastContainer';
import { cn } from '@/lib/utils';
import { passageService } from '@/services/passageService';
import { studyService } from '@/services/studyService';
import { formatDate, formatRelative } from '@/utils/datetime';
import { LEVEL_LABEL, scoreSummary, specSummary } from '@/utils/passage';
import type { Passage, PassageMode, PlanPassage, QuestionSetSummary } from '@/types/passage';
import type { NavigateFn, PassagePracticeReturn, PlanContext } from '../navigation';
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
}

const container = 'mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-8 py-7';
/** 题组行：名称、题型与难度、最近成绩；阅读 / 听力练习入口；⋯ 删除 */
const QuestionSetRow: React.FC<{ set: QuestionSetSummary; onStart: (mode: PassageMode) => void; onDelete: () => void }> = ({ set, onStart, onDelete }) => (
  <Card className="flex-row items-center gap-4 px-5 py-4">
    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
      <FileQuestion className="size-5" />
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="font-semibold">{set.name}</span>
        <span className="text-xs text-muted-foreground">{formatRelative(set.createdAt)}</span>
      </div>
      <div className="mt-0.5 truncate text-sm text-muted-foreground">{specSummary(set.spec)}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {set.lastAttempt
          ? `最近一次${set.lastAttempt.mode === 'listening' ? '听力' : '阅读'}：${scoreSummary(set.lastAttempt)}${set.completedAttempts > 1 ? ` · 共练 ${set.completedAttempts} 次` : ''}`
          : '未练习'}
      </div>
    </div>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" onClick={() => onStart('listening')}>
          <Headphones />
          听力练习
        </Button>
      </TooltipTrigger>
      <TooltipContent>不显示原文</TooltipContent>
    </Tooltip>
    <Button variant="outline" onClick={() => onStart('reading')}>
      <BookOpen />
      阅读练习
    </Button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="更多操作">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 />
          删除题组…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </Card>
);

/**
 * 短文详情：「原文」页签自由阅读（显示翻译、标出目标词、全文 / 逐句朗读）+ 侧栏（目标词、来源、场景）；
 * 「阅读理解」页签管理题组（生成、删除、阅读 / 听力练习）。
 */
export const PassageDetailPage: React.FC<PassageDetailPageProps> = ({ passageId, fromPlan, returnTo, clip: openedAsClip, onNavigate }) => {
  const toast = useToast();
  const [passage, setPassage] = useState<Passage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('text');
  const [focusWord, setFocusWord] = useState<string | null>(null);
  /** 正在给这篇出题的后台任务（离开再回来也接得上；这个页面开着时由页面提示结果） */
  const jobs = useJobs();
  const runningQs = passageId === undefined ? undefined : activeJobFor(jobs, ['question_set'], 'passageId', passageId);
  const [qsJobId, setQsJobId] = useState<string | null>(null);
  const qsJob = useJob(qsJobId ?? runningQs?.id ?? null);
  useOnJobFinished((job) => {
    if (job.kind !== 'question_set' || (job.link?.params as { passageId?: number } | null)?.passageId !== passageId) return;
    setQsJobId(null);
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
  const [showGenerate, setShowGenerate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [setToDelete, setSetToDelete] = useState<QuestionSetSummary | null>(null);
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
      setTab('video');
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
      toast.showSuccess(isClip ? '已删除片段' : '已删除短文');
      if (fromPlan) backToPlan();
      else if (isClip) onNavigate?.('videos', { tab: 'clips' });
      else onNavigate?.('passages');
    } else {
      toast.showError(isClip ? '无法删除片段' : '无法删除短文', result.error);
    }
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
  // 视频切片与导入的材料一样：原文不是 AI 生成的，重点词由 AI 识别，可以把未收录词加进单词本
  const imported = passage.origin !== 'generated';
  const required = passage.targetWords.filter((w) => w.required);
  const picked = passage.targetWords.filter((w) => !w.required);
  /** 有还没收录进单词本的目标词 */
  const hasNewWords = passage.targetWords.some((w) => w.wordId === null);
  /** 侧栏点目标词：到「目标词」页签看这个词的单词卡 */
  const openWord = (word: string) => {
    setFocusWord(word);
    setTab('words');
  };

  return (
    <div className={container}>
      {/* 头部：标题 / 水平 / 词数 / 时间 + 主操作（生成题组）+ ⋯ */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{passage.title}</h1>
            <Badge variant="secondary">{LEVEL_LABEL[passage.level] ?? passage.level}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {passage.origin === 'imported' && `导入${passage.sourceLabel ? `（${passage.sourceLabel}）` : ''} · `}
            {passage.origin === 'video' && `视频${passage.sourceLabel ? `（${passage.sourceLabel}）` : ''} · `}
            {passage.wordCount} 词 · {passage.sentences.length} 句 · {passage.origin === 'generated' ? '创建于' : '导入于'} {formatDate(passage.createdAt)}
            {passage.modelName && ` · ${passage.modelName}`}
          </p>
          <MaterialTags key={passage.id} kind="passage" refId={passage.id} tags={passage.tags} />
        </div>
        <div className="flex shrink-0 gap-2">
          <Button onClick={() => setShowGenerate(true)}>
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
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                <Trash2 />
                {isClip ? '删除片段…' : '删除短文…'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
          {passage.targetWords.length > 0 && (
            <TabsTrigger value="words" className="gap-1.5 px-3">
              目标词<span className="text-xs text-muted-foreground tabular-nums">{passage.targetWords.length}</span>
            </TabsTrigger>
          )}
          <TabsTrigger value="sets" className="gap-1.5 px-3">
            阅读理解<span className="text-xs text-muted-foreground tabular-nums">{passage.questionSets.length}</span>
          </TabsTrigger>
        </TabsList>

        {clip && (
          <TabsContent value="video">
            <ClipStudyPanel video={clip} sentences={passage.sentences} targetWords={passage.targetWords.map((w) => w.word)} onPractice={passage.questionSets.length > 0 ? () => setTab('sets') : undefined} />
          </TabsContent>
        )}

        <TabsContent value="text">
          <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-6">
            <ReadAloudPanel passage={passage} />

            <aside className="flex flex-col gap-4">
              <Card className="gap-3 px-5 py-4">
                <h2 className="text-sm font-semibold">目标词</h2>
                {required.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs text-muted-foreground">指定单词</div>
                    <div className="flex flex-wrap gap-1">
                      {required.map((w) => (
                        <button key={w.word} type="button" onClick={() => openWord(w.word)} className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground hover:ring-1 hover:ring-primary/40">
                          {w.word}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {picked.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs text-muted-foreground">{imported ? '重点词' : 'AI 选词'}</div>
                    <div className="flex flex-wrap gap-1">
                      {picked.map((w) => (
                        <button key={w.word} type="button" onClick={() => openWord(w.word)} className="rounded-full bg-muted px-2 py-0.5 text-xs hover:ring-1 hover:ring-primary/40" title={w.meaning ?? undefined}>
                          {w.word}
                          {w.meaning && <span className="text-muted-foreground"> {w.meaning}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
              {hasNewWords && <NewWordsCard passageId={passage.id} sourceLabel={passage.sourceLabel} onAdded={load} onOpenBook={(id) => onNavigate?.('wordbook-detail', { id })} />}
              {passage.sources.length > 0 && (
                <Card className="gap-3 px-5 py-4">
                  <h2 className="text-sm font-semibold">词汇来源</h2>
                  <div className="flex flex-wrap gap-1">
                    {passage.sources.map((s) => (
                      <SourceBadge key={`${s.kind}-${s.refId}`} source={s} />
                    ))}
                  </div>
                </Card>
              )}
              {passage.scene && (
                <Card className="gap-2 px-5 py-4">
                  <h2 className="text-sm font-semibold">场景</h2>
                  <p className="line-clamp-6 text-xs whitespace-pre-wrap text-muted-foreground select-text">{passage.scene}</p>
                </Card>
              )}
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="words">
          <TargetWordsPanel
            passage={passage}
            focusWord={focusWord}
            footer={hasNewWords && <NewWordsCard passageId={passage.id} sourceLabel={passage.sourceLabel ?? passage.title} onAdded={load} onOpenBook={(id) => onNavigate?.('wordbook-detail', { id })} />}
          />
        </TabsContent>

        <TabsContent value="sets">
          {qsJob && isJobActive(qsJob) && (
            <div className="mb-3">
              <JobPanel job={qsJob} title="AI 正在生成题组" actions={{ stop: true }} />
            </div>
          )}
          {passage.questionSets.length === 0 ? (
            <EmptyState icon={<FileQuestion />} title="还没有题组">
              <Button onClick={() => setShowGenerate(true)}>
                <Sparkles />
                生成题组
              </Button>
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-3">
              {passage.questionSets.map((s) => (
                <QuestionSetRow key={s.id} set={s} onStart={(mode) => startPractice(s.id, mode)} onDelete={() => setSetToDelete(s)} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <QuestionSetDialog
        isOpen={showGenerate}
        onClose={() => setShowGenerate(false)}
        passageId={passage.id}
        level={passage.level}
        existingSets={passage.questionSets.length}
        onStarted={(jobId) => {
          setQsJobId(jobId);
          setTab('sets');
        }}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isClip ? '删除片段' : '删除短文'}「{passage.title}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isClip
                ? `将同时删除片段视频、${passage.questionSets.length} 个题组与练习记录；原始视频不受影响。`
                : `将同时删除 ${passage.questionSets.length} 个题组与练习记录；单词本与学习计划不受影响。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={removePassage}>
              {isClip ? '删除片段' : '删除短文'}
            </AlertDialogAction>
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
