import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, Clock, FileText, Loader2, RotateCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useToast } from '@/components/Toast/ToastContainer';
import { PlanningProgress } from '@/components/PlanningProgress';
import { WordBookSelector, type WordBookOption } from '@/components/WordBookSelector';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { wordBookService } from '@/services/wordbookService';
import { studyService } from '@/services/studyService';
import { passageService } from '@/services/passageService';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useJob, waitForJob } from '@/hooks/useJobs';
import { jobService } from '@/services/jobService';
import { jobErrorText } from '@/components/Jobs';
import { addLocalDays, localToday } from '@/utils/datetime';
import { CONSOLIDATION_DAYS, DAILY_NEW_WORDS_OPTIONS, DEFAULT_DAILY_NEW_WORDS, estimatePlan } from '@/utils/planParams';
import type { ApiResult, PracticeContent, StudyPlanAIResult } from '@/types';
import type { PlanPassageCandidate } from '@/types/passage';
import {
  DEFAULT_PASSAGE_INTERVAL,
  PASSAGE_INTERVAL_OPTIONS,
  PlanPassagePicker,
  intervalLabel,
  toPassageInputs,
  type PlanPassageDraft,
} from '@/components/PlanPassagePicker';
import type { NavigateFn } from '@/navigation';
import { PageError } from '@/components/PageError';
import { messageOf } from '@/utils/errorHandler';
import { InlineError } from '@/components/InlineError';

export interface CreatePlanPageProps {
  /** Navigation handler */
  onNavigate?: NavigateFn;
}

/** 创建过程：idle 填写中 → planning AI 排序中 → failed AI 失败（可改用默认顺序）→ saving 保存中 */
type Phase = 'idle' | 'planning' | 'failed' | 'saving';

/** 预览里展示的天数 */
const PREVIEW_DAYS = 3;
const PREVIEW_WORDS_PER_DAY = 10;

/** 没填名称时按所选单词本（只练短文时按短文）生成 */
const autoName = (books: WordBookOption[], passages: PlanPassageDraft[]) => {
  if (books.length > 0) return books.length === 1 ? `${books[0].name} 学习计划` : `${books[0].name} 等 ${books.length} 本学习计划`;
  if (passages.length > 0) return passages.length === 1 ? `「${passages[0].title}」阅读计划` : `${passages[0].title} 等 ${passages.length} 篇阅读计划`;
  return '';
};

const CONTENT_OPTIONS: { value: PracticeContent; label: string }[] = [
  { value: 'words', label: '单词' },
  { value: 'both', label: '单词 + 短文' },
  { value: 'passages', label: '短文' },
];

/**
 * 创建学习计划（单页：左边填写、右边即时预览，DECISIONS D20 / authoring-flows-redesign B4）：
 * 选单词本 → 每天新词数 → 是否用 AI 排学习顺序 → 名称与描述；右侧按确定性规则即时显示总词数、天数与前几天的新词。
 * 创建后为“待开始”，第一次练习的那天算第 1 天。AI 排序可取消；失败时可以改用默认顺序直接创建。
 */
export const CreatePlanPage: React.FC<CreatePlanPageProps> = ({ onNavigate }) => {
  const toast = useToast();
  const [content, setContent] = useState<PracticeContent>('words');
  const [passages, setPassages] = useState<PlanPassageDraft[]>([]);
  const [passageInterval, setPassageInterval] = useState(DEFAULT_PASSAGE_INTERVAL);
  const [candidates, setCandidates] = useState<PlanPassageCandidate[] | null>(null);
  const [selectedBooks, setSelectedBooks] = useState<number[]>([]);
  const [dailyNewWords, setDailyNewWords] = useState(DEFAULT_DAILY_NEW_WORDS);
  const [useAi, setUseAi] = useState(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<StudyPlanAIResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  /** 进行中的 AI 排序任务（离开页面或停止时取消） */
  const jobRef = useRef<string | null>(null);
  const [planJobId, setPlanJobId] = useState<string | null>(null);
  const planJob = useJob(planJobId);

  const { data: rawBooks, loading: loadingBooks, error: loadError, refresh: reloadBooks } = useAsyncData(async () => {
    const result = await wordBookService.getAllWordBooks();
    // 空单词本不能用于计划
    if (result.success) return result.data.filter((b) => b.status === 'normal' && b.total_words > 0);
    throw new Error(result.error);
  });
  const wordBooks: WordBookOption[] = (rawBooks ?? []).map((b) => ({
    id: b.id,
    name: b.title,
    description: b.description,
    wordCount: b.total_words,
    icon: b.icon,
    color: b.icon_color,
  }));
  const withWords = content !== 'passages';
  const withPassages = content !== 'words';
  const chosenBooks = withWords ? wordBooks.filter((b) => selectedBooks.includes(b.id)) : [];
  const suggestedName = autoName(chosenBooks, passages);
  const planName = name.trim() || suggestedName;
  const busy = phase === 'planning' || phase === 'saving';

  // 可加入的短文：按与所选单词本的相关度排序（只练短文时不看单词本）
  const candidateBookIds = withWords ? selectedBooks : [];
  const candidateKey = candidateBookIds.join(',');
  useEffect(() => {
    if (!withPassages) return;
    let stale = false;
    passageService.getPlanPassageCandidates({ bookIds: candidateKey ? candidateKey.split(',').map(Number) : [] }).then((result) => {
      if (stale) return;
      if (result.success) setCandidates(result.data);
      else {
        setCandidates([]);
        toast.showError('无法加载短文库', result.error);
      }
    });
    return () => {
      stale = true;
    };
  }, [withPassages, candidateKey, toast]);

  // 即时预览：单词本或每天新词数变化后 200ms 请求一次（去重后的真实词数与天数）
  useEffect(() => {
    if (!withWords || selectedBooks.length === 0) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    let stale = false;
    setPreviewLoading(true);
    const timer = window.setTimeout(async () => {
      const result = await studyService.previewStudyPlan(selectedBooks, dailyNewWords);
      if (stale) return;
      setPreviewLoading(false);
      if (result.success) {
        setPreview(result.data);
        setPreviewError(null);
      } else {
        setPreview(null);
        setPreviewError(result.error);
      }
    }, 200);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [withWords, selectedBooks, dailyNewWords]);

  // 离开页面时若仍在 AI 排序：取消任务（结果只给这个页面用，否则 AI 会在后台空跑、消耗额度）
  useEffect(
    () => () => {
      if (jobRef.current) void jobService.cancel(jobRef.current);
    },
    []
  );

  const stopPlanning = async () => {
    const id = jobRef.current;
    jobRef.current = null;
    setPhase('idle');
    if (!id) return;
    const cancelled = await jobService.cancel(id);
    if (!cancelled.success) toast.showWarning('AI 排序可能还在后台运行', cancelled.error);
  };

  /** 排日程（AI 或默认顺序）→ 保存为“待开始”→ 进入计划详情 */
  const passageFields = () =>
    withPassages ? { passages: toPassageInputs(passages), passageIntervalDays: passageInterval } : {};

  const finish = (planId: number) => {
    toast.showSuccess(`已创建「${planName}」`);
    onNavigate?.('plan-detail', { planId });
  };

  /** 只练短文：没有单词日程，直接保存 */
  const createPassagesOnly = async () => {
    if (!planName || passages.length === 0) return;
    setError(null);
    setPhase('saving');
    const startDate = localToday();
    const saved = await studyService.createStudyPlanWithSchedule({
      name: planName,
      description: description.trim(),
      startDate,
      endDate: addLocalDays(startDate, (passages.length - 1) * passageInterval),
      aiPlanData: '',
      wordbookIds: [],
      status: 'normal',
      practiceContent: 'passages',
      ...passageFields(),
    });
    if (!saved.success) {
      setError(saved.error);
      setPhase('idle');
      return;
    }
    finish(saved.data);
  };

  const create = async (withAi: boolean) => {
    if (!withWords) return createPassagesOnly();
    if (!planName || selectedBooks.length === 0) return;
    if (withPassages && passages.length === 0) return;
    setError(null);
    setPhase(withAi ? 'planning' : 'saving');
    try {
      const request = {
        name: planName,
        description: description.trim(),
        dailyNewWords,
        startDate: localToday(), // 第一次练习时会再平移到那一天
        wordbookIds: selectedBooks,
        useAi: withAi,
      };
      let scheduled: ApiResult<StudyPlanAIResult>;
      if (withAi) {
        const started = await studyService.startStudyPlanOrdering(request);
        if (!started.success) throw new Error(started.error);
        jobRef.current = started.data;
        setPlanJobId(started.data);
        const job = await waitForJob(started.data);
        // 用户停止或已离开页面
        if (jobRef.current !== started.data || job.status === 'cancelled') return;
        jobRef.current = null;
        if (job.status === 'failed') throw new Error(jobErrorText(job));
        scheduled = { success: true, data: job.result as StudyPlanAIResult };
      } else {
        scheduled = await studyService.generateStudyPlanSchedule(request);
      }
      if (!scheduled.success) throw new Error(scheduled.error);
      setPhase('saving');
      const meta = scheduled.data.planMetadata;
      const saved = await studyService.createStudyPlanWithSchedule({
        name: planName,
        description: description.trim(),
        startDate: request.startDate,
        endDate: meta.endDate,
        aiPlanData: JSON.stringify(scheduled.data),
        wordbookIds: selectedBooks,
        status: 'normal',
        practiceContent: content,
        ...passageFields(),
      });
      if (!saved.success) throw new Error(saved.error);
      finish(saved.data);
    } catch (err) {
      jobRef.current = null;
      setError(messageOf(err) ?? '请再试一次');
      setPhase(withAi ? 'failed' : 'idle');
    }
  };

  if (loadError && !loadingBooks) {
    return (
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-8 py-7">
        <PageHeader title="新建学习计划" />
        <PageError title="无法加载单词本" message={loadError.message} onRetry={reloadBooks} back={{ label: '返回学习计划', onClick: () => onNavigate?.('plans') }} />
      </div>
    );
  }

  const meta = preview?.planMetadata;
  const minutes = meta ? estimatePlan(meta.totalWords, dailyNewWords, '').minutesPerDay : 0;
  const learningDays = preview?.dailyPlans.length ?? 0;
  const passageDays = passages.length > 0 ? (passages.length - 1) * passageInterval + 1 : 0;
  const wordsReady = !withWords || (selectedBooks.length > 0 && Boolean(meta));
  const passagesReady = !withPassages || passages.length > 0;
  const canCreate = !busy && Boolean(planName) && wordsReady && passagesReady;
  const aiOrdering = withWords && useAi;

  const section = (title: string, children: React.ReactNode) => (
    <section className="space-y-3">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
  );

  const segmented = 'w-full rounded-lg bg-muted p-0.5';
  const segment = 'h-8 flex-1 rounded-md data-[state=on]:bg-background data-[state=on]:shadow-sm';

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-8 py-7">
      <PageHeader title="新建学习计划" />

      <div className="grid grid-cols-[minmax(0,1fr)_380px] items-start gap-6">
        {/* 左：填写 */}
        <Card className="gap-8 p-6">
          {section(
            '练什么',
            <ToggleGroup
              type="single"
              value={content}
              onValueChange={(v) => v && setContent(v as PracticeContent)}
              className={segmented}
              aria-label="练习内容"
              disabled={busy}
            >
              {CONTENT_OPTIONS.map((o) => (
                <ToggleGroupItem key={o.value} value={o.value} className={segment}>
                  {o.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}

          {withWords &&
            section(
              '单词本',
              <WordBookSelector
                books={wordBooks}
                selectedBooks={selectedBooks}
                onSelectionChange={setSelectedBooks}
                loading={loadingBooks}
                onCreateBook={() => onNavigate?.('wordbooks')}
              />
            )}

          {withWords &&
            section(
              '每天学几个新词',
              <ToggleGroup
                type="single"
                value={String(dailyNewWords)}
                onValueChange={(v) => v && setDailyNewWords(Number(v))}
                className={segmented}
                aria-label="每天新词数"
                disabled={busy}
              >
                {DAILY_NEW_WORDS_OPTIONS.map((o) => (
                  <ToggleGroupItem key={o.value} value={String(o.value)} className={segment}>
                    {o.value}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}

          {withWords &&
            section(
              '学习顺序',
              <label className="flex items-center gap-3 rounded-lg border p-3">
                <Sparkles className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 text-sm font-medium">AI 按难易排序</span>
                <Switch checked={useAi} onCheckedChange={setUseAi} disabled={busy} aria-label="AI 按难易排序" />
              </label>
            )}

          {withPassages &&
            section(
              '短文',
              <div className="space-y-4">
                <PlanPassagePicker
                  items={passages}
                  onChange={setPassages}
                  candidates={candidates}
                  notes={passages.map((_, i) => `第 ${i * passageInterval + 1} 天`)}
                  overlapLabel={withWords ? '所选单词' : '单词'}
                  onCreatePassage={() => onNavigate?.('create-passage', { bookIds: candidateBookIds })}
                  disabled={busy}
                />
                <div className="space-y-2">
                  <Label>多久一篇</Label>
                  <ToggleGroup
                    type="single"
                    value={String(passageInterval)}
                    onValueChange={(v) => v && setPassageInterval(Number(v))}
                    className={segmented}
                    aria-label="短文间隔"
                    disabled={busy}
                  >
                    {PASSAGE_INTERVAL_OPTIONS.map((d) => (
                      <ToggleGroupItem key={d} value={String(d)} className={segment}>
                        {d === 1 ? '每天' : `${d} 天`}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              </div>
            )}

          {section(
            '名称与描述',
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="plan-name">计划名称</Label>
                <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={suggestedName || '例如：三年级上册词汇'} maxLength={100} disabled={busy} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plan-desc">描述</Label>
                <Textarea id="plan-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="学习目标或备注" className="min-h-16 resize-none" disabled={busy} />
              </div>
            </div>
          )}
        </Card>

        {/* 右：即时预览 + 创建 */}
        <Card className="sticky top-6 gap-5 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">学习安排</h2>
            {withWords && previewLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>

          {withWords &&
            (selectedBooks.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">还没有选择单词本</p>
            ) : previewError ? (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{previewError}</p>
            ) : !meta ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-muted/50 p-3">
                    <div className="text-2xl font-semibold tabular-nums">{meta.totalWords}</div>
                    <div className="text-xs text-muted-foreground">个新词</div>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-3">
                    <div className="text-2xl font-semibold tabular-nums">{meta.studyPeriodDays}</div>
                    <div className="text-xs text-muted-foreground">
                      天 · 学新词 {learningDays} 天，巩固 {CONSOLIDATION_DAYS} 天
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="size-4" />每天 {dailyNewWords} 个新词
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="size-4" />约 {minutes} 分钟 / 天
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">前几天的新词</div>
                  <ol className="space-y-2">
                    {preview!.dailyPlans.slice(0, PREVIEW_DAYS).map((day) => (
                      <li key={day.day} className="flex gap-3 text-sm">
                        <span className="w-12 shrink-0 text-muted-foreground tabular-nums">第 {day.day} 天</span>
                        <span className="min-w-0 flex-1 text-foreground">
                          {day.words.slice(0, PREVIEW_WORDS_PER_DAY).map((w) => w.word).join('、')}
                          {day.words.length > PREVIEW_WORDS_PER_DAY && <span className="text-muted-foreground"> 等 {day.words.length} 个</span>}
                        </span>
                      </li>
                    ))}
                    {learningDays > PREVIEW_DAYS && <li className="pl-15 text-xs text-muted-foreground">… 共 {learningDays} 天学新词</li>}
                  </ol>
                </div>
              </>
            ))}

          {withPassages &&
            (passages.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">还没有添加短文</p>
            ) : (
              <div className={withWords ? 'space-y-2 border-t pt-4' : 'space-y-2'}>
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <FileText className="size-4 text-muted-foreground" />
                  {passages.length} 篇短文 · {intervalLabel(passageInterval)} · 共 {passageDays} 天
                </div>
                <ol className="space-y-1.5">
                  {passages.slice(0, PREVIEW_DAYS).map((p, i) => (
                    <li key={p.passageId} className="flex gap-3 text-sm">
                      <span className="w-12 shrink-0 text-muted-foreground tabular-nums">第 {i * passageInterval + 1} 天</span>
                      <span className="min-w-0 flex-1 truncate">{p.title}</span>
                    </li>
                  ))}
                  {passages.length > PREVIEW_DAYS && <li className="pl-15 text-xs text-muted-foreground">… 共 {passages.length} 篇</li>}
                </ol>
              </div>
            ))}

          <div className="space-y-3 border-t pt-4">
            {phase === 'planning' && <PlanningProgress job={planJob} onCancel={stopPlanning} />}
            {error && (
              <InlineError
                title={phase === 'failed' ? 'AI 排序没有完成' : '无法创建计划'}
                actions={
                  phase === 'failed' && (
                    <>
                      <Button size="sm" variant="outline" className="bg-background" onClick={() => create(false)}>
                        用默认顺序创建
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => create(true)}>
                        <RotateCw />
                        重试 AI 排序
                      </Button>
                    </>
                  )
                }
              >
                {error}
              </InlineError>
            )}
            {phase !== 'planning' && (
              <Button className="w-full" onClick={() => create(aiOrdering)} disabled={!canCreate}>
                {phase === 'saving' ? <Loader2 className="animate-spin" /> : aiOrdering && <Sparkles />}
                {phase === 'saving' ? '正在创建…' : aiOrdering ? '用 AI 排序并创建' : '创建计划'}
              </Button>
            )}
            {phase !== 'planning' && (
              <Button variant="ghost" className="w-full" onClick={() => onNavigate?.('plans')} disabled={phase === 'saving'}>
                取消
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};
