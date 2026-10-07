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
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { PageError } from '@/components/PageError';
import { SourceBadge } from '@/components/PassageList';
import { QuestionSetDialog } from '@/components/QuestionSetDialog';
import { ReadAloudPanel } from './passage-detail/ReadAloudPanel';
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
          : '还没练过'}
      </div>
    </div>
    <Button variant="outline" onClick={() => onStart('listening')}>
      <Headphones />
      听力练习
    </Button>
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
export const PassageDetailPage: React.FC<PassageDetailPageProps> = ({ passageId, fromPlan, returnTo, onNavigate }) => {
  const toast = useToast();
  const [passage, setPassage] = useState<Passage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('text');
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
      toast.showError('无法标记为读完', result.error);
      return;
    }
    toast.showSuccess(`已读完「${planTask?.title ?? passage?.title ?? '短文'}」`);
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

  const startPractice = (setId: number, mode: PassageMode) => {
    onNavigate?.('passage-practice', { setId, mode });
  };

  const removePassage = async () => {
    if (!passage) return;
    const result = await passageService.deletePassage(passage.id);
    setConfirmDelete(false);
    if (result.success) {
      toast.showSuccess('已删除短文');
      if (fromPlan) backToPlan();
      else onNavigate?.('passages');
    } else {
      toast.showError('无法删除短文', result.error);
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
        <PageError title="无法打开短文" message={error} onRetry={load} back={fromPlan ? { label: returnTo === 'home' ? '返回首页' : returnTo === 'calendar' ? '返回日历' : '返回计划', onClick: backToPlan } : { label: '返回短文库', onClick: () => onNavigate?.('passages') }} />
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

  // 导入的材料：单词本里的词（required）/ AI 标出的重点词；AI 写的短文：必用词 / AI 按场景挑选
  const imported = passage.origin === 'imported';
  const required = passage.targetWords.filter((w) => w.required);
  const picked = passage.targetWords.filter((w) => !w.required);

  return (
    <div className={container}>
      {/* 头部：标题 / 水平 / 词数 / 时间 + 主操作（生成阅读理解题）+ ⋯ */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{passage.title}</h1>
            <Badge variant="secondary">{LEVEL_LABEL[passage.level] ?? passage.level}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {passage.origin === 'imported' && `我的材料${passage.sourceLabel ? `（${passage.sourceLabel}）` : ''} · `}
            {passage.wordCount} 个英文单词 · {passage.sentences.length} 句 · {passage.origin === 'imported' ? '导入于' : '创建于'} {formatDate(passage.createdAt)}
            {passage.modelName && ` · ${passage.modelName}`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button onClick={() => setShowGenerate(true)}>
            <Sparkles />
            生成阅读理解题
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
                删除短文…
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
              · {formatDate(planTask.scheduledDate)} · {taskLabel(planTask.setName, planTask.setId, planTask.mode)}
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
              读完了
            </Button>
          )}
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList>
          <TabsTrigger value="text" className="px-3">
            原文
          </TabsTrigger>
          <TabsTrigger value="sets" className="gap-1.5 px-3">
            阅读理解<span className="text-xs text-muted-foreground tabular-nums">{passage.questionSets.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="text">
          <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-6">
            <ReadAloudPanel passage={passage} />

            <aside className="flex flex-col gap-4">
              <Card className="gap-3 px-5 py-4">
                <h2 className="text-sm font-semibold">目标词</h2>
                {required.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs text-muted-foreground">{passage.origin === 'imported' ? '单词本里的词' : '必用词'}</div>
                    <div className="flex flex-wrap gap-1">
                      {required.map((w) => (
                        <span key={w.word} className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
                          {w.word}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {picked.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs text-muted-foreground">{passage.origin === 'imported' ? 'AI 标出的重点词' : 'AI 按场景挑选'}</div>
                    <div className="flex flex-wrap gap-1">
                      {picked.map((w) => (
                        <span key={w.word} className="rounded-full bg-muted px-2 py-0.5 text-xs" title={w.meaning ?? undefined}>
                          {w.word}
                          {w.meaning && <span className="text-muted-foreground"> {w.meaning}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
              {imported && <NewWordsCard passageId={passage.id} sourceLabel={passage.sourceLabel} onAdded={load} onOpenBook={(id) => onNavigate?.('wordbook-detail', { id })} />}
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

        <TabsContent value="sets">
          {passage.questionSets.length === 0 ? (
            <EmptyState icon={<FileQuestion />} title="还没有阅读理解题" description="选好题型、题量和难度，AI 根据这篇短文出一套题；一篇短文可以有多套题">
              <Button onClick={() => setShowGenerate(true)}>
                <Sparkles />
                生成阅读理解题
              </Button>
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-3">
              <p className={cn('text-sm text-muted-foreground')}>阅读练习看着原文答题；听力练习先只听不看原文（不考选词填空），提交后再看原文与翻译。成绩单独统计，不影响单词的记忆等级。</p>
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
        onGenerated={(set) => {
          toast.showSuccess(`已生成「${set.name}」`, `共 ${set.questions.length} 题`);
          setTab('sets');
          load();
        }}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除短文「{passage.title}」？</AlertDialogTitle>
            <AlertDialogDescription>短文、它的 {passage.questionSets.length} 套阅读理解题和练习记录都会删除，单词本和学习计划不受影响。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={removePassage}>
              删除短文
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={setToDelete !== null} onOpenChange={(open) => !open && setSetToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除题组「{setToDelete?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>这套题和它的练习记录会删除，短文本身不受影响。</AlertDialogDescription>
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
