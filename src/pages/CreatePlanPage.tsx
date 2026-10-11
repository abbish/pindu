import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useToast } from '@/components/Toast/ToastContainer';
import { WordBookSelector, type WordBookOption } from '@/components/WordBookSelector';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { wordBookService } from '@/services/wordbookService';
import { studyService } from '@/services/studyService';
import { passageService } from '@/services/passageService';
import { useAsyncData } from '@/hooks/useAsyncData';
import { addLocalDays, localToday } from '@/utils/datetime';
import { useMaterialSettings } from '@/hooks/useMaterialSettings';
import { CONSOLIDATION_DAYS, DAILY_NEW_WORDS_OPTIONS, DEFAULT_DAILY_NEW_WORDS, estimatePlan } from '@/utils/planParams';
import type { PracticeContent, StudyPlanAIResult } from '@/types';
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
import { InlineError } from '@/components/InlineError';

export interface CreatePlanPageProps {
  /** Navigation handler */
  onNavigate?: NavigateFn;
}

/** 创建过程：idle 填写中 → saving 保存中（从易到难的顺序在保存后由后台任务排） */
type Phase = 'idle' | 'saving';

/** 没填名称时按所选词汇本（只练短文时按短文）生成 */
const autoName = (books: WordBookOption[], passages: PlanPassageDraft[]) => {
  if (books.length > 0) return books.length === 1 ? `${books[0].name} 学习计划` : `${books[0].name} 等 ${books.length} 本学习计划`;
  if (passages.length > 0) return passages.length === 1 ? `「${passages[0].title}」阅读计划` : `${passages[0].title} 等 ${passages.length} 篇阅读计划`;
  return '';
};

/** 学习顺序：从易到难（AI 按拼读规律排）/ 按词汇本里的顺序 */
type OrderMode = 'easy' | 'book';

export const CreatePlanPage: React.FC<CreatePlanPageProps> = ({ onNavigate }) => {
  const toast = useToast();
  const [passages, setPassages] = useState<PlanPassageDraft[]>([]);
  const [passageInterval, setPassageInterval] = useState(DEFAULT_PASSAGE_INTERVAL);
  const [candidates, setCandidates] = useState<PlanPassageCandidate[] | null>(null);
  const [selectedBooks, setSelectedBooks] = useState<number[]>([]);
  const [dailyNewWords, setDailyNewWords] = useState(DEFAULT_DAILY_NEW_WORDS);
  const [order, setOrder] = useState<OrderMode>('easy');
  // 每天新词数、短文间隔、AI 排序的默认值来自「设置 → 素材」
  const materialSettings = useMaterialSettings();
  useEffect(() => {
    if (!materialSettings) return;
    setDailyNewWords(materialSettings.planDailyNewWords);
    setPassageInterval(materialSettings.planPassageIntervalDays);
    setOrder(materialSettings.planAiOrder ? 'easy' : 'book');
  }, [materialSettings]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<StudyPlanAIResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  /** 进行中的 AI 排序任务（离开页面或停止时取消） */

  const { data: rawBooks, loading: loadingBooks, error: loadError, refresh: reloadBooks } = useAsyncData(async () => {
    const result = await wordBookService.getAllWordBooks();
    // 空词汇本不能用于计划
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
  // 练什么由选择推出
  const withWords = selectedBooks.length > 0;
  const withPassages = passages.length > 0;
  const content: PracticeContent = withWords && withPassages ? 'both' : withPassages ? 'passages' : 'words';
  const chosenBooks = wordBooks.filter((b) => selectedBooks.includes(b.id));
  const suggestedName = autoName(chosenBooks, passages);
  const planName = name.trim() || suggestedName;
  const busy = phase === 'saving';

  // 可加入的短文：按与所选词汇本的相关度排序
  const candidateBookIds = selectedBooks;
  const candidateKey = candidateBookIds.join(',');
  useEffect(() => {
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
  }, [candidateKey, toast]);

  // 即时预览：词汇本或每天新词数变化后 200ms 请求一次（去重后的真实词数与天数）
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

  const passageFields = () =>
    withPassages ? { passages: toPassageInputs(passages), passageIntervalDays: passageInterval } : {};

  const finish = () => {
    toast.showSuccess(`已创建「${planName}」`);
    onNavigate?.('plans');
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
    finish();
  };

  /** 按词汇本顺序排好日程并保存（马上能用）；选了从易到难时，再在后台重排还没学的词，进度显示在计划卡上 */
  const create = async () => {
    if (!withWords) return createPassagesOnly();
    if (!planName || selectedBooks.length === 0) return;
    setError(null);
    setPhase('saving');
    const request = {
      name: planName,
      description: description.trim(),
      dailyNewWords,
      startDate: localToday(), // 第一次练习时会再平移到那一天
      wordbookIds: selectedBooks,
      useAi: false,
    };
    const scheduled = await studyService.generateStudyPlanSchedule(request);
    const saved = scheduled.success
      ? await studyService.createStudyPlanWithSchedule({
          name: planName,
          description: description.trim(),
          startDate: request.startDate,
          endDate: scheduled.data.planMetadata.endDate,
          aiPlanData: JSON.stringify(scheduled.data),
          wordbookIds: selectedBooks,
          status: 'normal',
          practiceContent: content,
          ...passageFields(),
        })
      : scheduled;
    if (!saved.success) {
      setError(saved.error);
      setPhase('idle');
      return;
    }
    if (order === 'easy') {
      const started = await studyService.startStudyPlanOrdering(saved.data);
      if (!started.success) toast.showWarning('没能开始安排学习顺序', `计划先按词汇本里的顺序安排。${started.error}`);
    }
    toast.showSuccess(`已创建「${planName}」`);
    onNavigate?.('plans');
  };

  if (loadError && !loadingBooks) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-7">
        <PageHeader title="新建学习计划" />
        <PageError title="无法加载词汇本" message={loadError.message} onRetry={reloadBooks} back={{ label: '返回学习计划', onClick: () => onNavigate?.('plans') }} />
      </div>
    );
  }

  const meta = preview?.planMetadata;
  const minutes = meta ? estimatePlan(meta.totalWords, dailyNewWords, '').minutesPerDay : 0;
  const learningDays = preview?.dailyPlans.length ?? 0;
  const passageDays = passages.length > 0 ? (passages.length - 1) * passageInterval + 1 : 0;
  const wordsReady = !withWords || Boolean(meta);
  const canCreate = !busy && Boolean(planName) && (withWords || withPassages) && wordsReady;

  const container = 'mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 pt-7';
  const segmented = 'w-full rounded-lg bg-muted p-0.5';
  const segment = 'h-8 flex-1 rounded-md data-[state=on]:bg-background data-[state=on]:shadow-sm';
  const section = (n: number, title: string, children: React.ReactNode) => (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        <span className="flex size-5 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground tabular-nums">{n}</span>
        {title}
      </h2>
      <div className="space-y-5 pl-7">{children}</div>
    </section>
  );
  /** 选项下面一行：这个选择的结果 */
  const outcome = (children: React.ReactNode) => <p className="text-sm text-muted-foreground">{children}</p>;

  return (
    <div className="flex min-h-full flex-col">
      <div className={container}>
        <PageHeader title="新建学习计划" />

        <Card className="gap-8 p-6">
          {section(
            1,
            '学什么',
            <>
              <div className="space-y-2">
                <Label>词汇本</Label>
                <WordBookSelector
                  books={wordBooks}
                  selectedBooks={selectedBooks}
                  onSelectionChange={setSelectedBooks}
                  loading={loadingBooks}
                  onCreateBook={() => onNavigate?.('wordbooks')}
                />
              </div>
              <div className="space-y-2">
                <Label>
                  短文和场景片段<span className="font-normal text-muted-foreground">（可选）</span>
                </Label>
                <PlanPassagePicker
                  items={passages}
                  onChange={setPassages}
                  candidates={candidates}
                  notes={passages.map((_, i) => `第 ${i * passageInterval + 1} 天`)}
                  overlapLabel={withWords ? '所选单词' : '单词'}
                  onCreatePassage={() => onNavigate?.('create-passage', { bookIds: candidateBookIds })}
                  disabled={busy}
                />
              </div>
            </>
          )}

          {section(
            2,
            '每天学多少',
            !withWords && !withPassages ? (
              outcome('先选好要学的词汇本或短文')
            ) : (
              <>
                {withWords && (
                  <div className="space-y-2">
                    <Label>每天学几个新词</Label>
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
                    {previewError ? (
                      <p className="text-sm text-destructive">{previewError}</p>
                    ) : meta ? (
                      outcome(
                        <>
                          {meta.totalWords} 个新词，共 {meta.studyPeriodDays} 天：{learningDays} 天学新词，之后 {CONSOLIDATION_DAYS} 天复习巩固 · 每天约 {minutes} 分钟
                          {previewLoading && <Loader2 className="ml-1.5 inline size-3.5 animate-spin" />}
                        </>
                      )
                    ) : (
                      <Skeleton className="h-5 w-80" />
                    )}
                  </div>
                )}
                {withPassages && (
                  <div className="space-y-2">
                    <Label>多久一篇短文</Label>
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
                    {outcome(`${passages.length} 篇，${intervalLabel(passageInterval)}，共 ${passageDays} 天`)}
                  </div>
                )}
              </>
            )
          )}

          {withWords &&
            section(
              3,
              '学习顺序',
              <RadioGroup value={order} onValueChange={(v) => setOrder(v as OrderMode)} disabled={busy} aria-label="学习顺序">
                {(
                  [
                    { value: 'easy', label: '从易到难（推荐）', hint: '按拼读规律由简到繁，同一规律的词放在一起学' },
                    { value: 'book', label: '按词汇本里的顺序', hint: '适合跟着课本单元学' },
                  ] as const
                ).map((o) => (
                  <Label key={o.value} className="flex cursor-default items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary/60 has-[[data-state=checked]]:bg-accent/30">
                    <RadioGroupItem value={o.value} className="mt-0.5" />
                    <span className="space-y-0.5">
                      <span className="block text-sm font-medium">{o.label}</span>
                      <span className="block text-xs text-muted-foreground">{o.hint}</span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            )}

          {section(
            withWords ? 4 : 3,
            '名称',
            <>
              <Input id="plan-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={suggestedName || '例如：三年级上册词汇'} maxLength={100} disabled={busy} aria-label="计划名称" />
              <div className="space-y-2">
                <Label htmlFor="plan-desc">
                  描述<span className="font-normal text-muted-foreground">（可选）</span>
                </Label>
                <Textarea id="plan-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="学习目标或备注" className="min-h-16 resize-none" disabled={busy} />
              </div>
            </>
          )}
        </Card>

        {error && (
          <InlineError title="无法创建计划">{error}</InlineError>
        )}
      </div>

      {/* 底部操作栏 */}
      <div className="sticky bottom-0 mt-6 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-end gap-2 px-8 py-3">
          <Button variant="ghost" onClick={() => onNavigate?.('plans')} disabled={busy}>
            取消
          </Button>
          <Button onClick={() => void create()} disabled={!canCreate}>
            {busy && <Loader2 className="animate-spin" />}
            {busy ? '正在创建…' : '创建计划'}
          </Button>
        </div>
      </div>
    </div>
  );
};
