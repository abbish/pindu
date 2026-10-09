import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CircleAlert,
  ChevronLeft,
  ChevronRight,
  Clock,
  Headphones,
  Languages,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Snail,
  Sparkles,
  X,
} from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { InlineError } from '@/components/InlineError';
import { PageError } from '@/components/PageError';
import { PassageReader } from '@/components/PassageReader';
import { useSentencePlayer } from '@/hooks/useSentencePlayer';
import { useClipSentencePlayer } from '@/hooks/useClipSentencePlayer';
import { videoService } from '@/services/videoService';
import { cn } from '@/lib/utils';
import { passageService } from '@/services/passageService';
import { formatDuration } from '@/utils/datetime';
import { MODE_LABEL, scoreSummary, splitWithBlanks } from '@/utils/passage';
import type { ClozeResult, Passage, PassageAttempt, PassageMode, PassageQuestion, PassageSentence, QuestionResult, QuestionSet } from '@/types/passage';
import type { NavigateFn, PassagePracticeReturn } from '../navigation';

export interface PassagePracticePageProps {
  setId?: number;
  mode?: PassageMode;
  /** 从计划里的短文任务进入：作答计入这个计划 */
  planId?: number;
  /** 练完 / 退出回到哪里（默认短文详情） */
  returnTo?: PassagePracticeReturn;
  onNavigate?: NavigateFn;
}

const OPEN_MAX = 500;

/** 题目 / 空位的 DOM id（提交时定位第一个没作答的） */
const questionDomId = (id: number) => `passage-question-${id}`;

// ==================== 听力播放器 ====================

const NO_SENTENCES: PassageSentence[] = [];

/** 逐句听：连播 / 暂停、上一句 / 下一句、重听本句；答题时不显示原文。视频切片用原声，其余用合成语音 */
const ListeningPlayer: React.FC<{ texts: string[]; clip?: { url: string; sentences: PassageSentence[] } }> = ({ texts, clip }) => {
  const [slow, setSlow] = useState(false);
  const tts = useSentencePlayer(texts, { speed: slow ? 'slow' : 'normal' });
  const original = useClipSentencePlayer(clip?.url ?? null, clip?.sentences ?? NO_SENTENCES, { slow });
  const player = clip ? original : tts;
  const current = player.current ?? 0;
  const go = (delta: number) => player.play(Math.min(texts.length - 1, Math.max(0, current + delta)), true);
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border bg-muted/30 px-6 py-6 select-none">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Headphones className="size-4" />第 {current + 1} / {texts.length} 句{player.loading && <Loader2 className="size-3.5 animate-spin" />}
      </div>
      <div className="flex gap-1" aria-hidden>
        {texts.map((_, i) => (
          <span key={i} className={cn('h-1.5 w-6 rounded-full', i < current ? 'bg-primary/40' : i === current ? 'bg-primary' : 'bg-border')} />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="上一句" onClick={() => go(-1)} disabled={current === 0}>
          <ChevronLeft />
        </Button>
        <Button size="lg" className="min-w-36" onClick={() => (player.playing ? player.stop() : player.play(current))}>
          {player.playing ? <Pause /> : <Play />}
          {player.playing ? '暂停' : current === 0 ? '播放全文' : '从这句继续'}
        </Button>
        <Button variant="outline" size="icon" aria-label="下一句" onClick={() => go(1)} disabled={current >= texts.length - 1}>
          <ChevronRight />
        </Button>
        <Button variant="ghost" onClick={() => player.play(current, true)}>
          <RotateCcw />
          重听本句
        </Button>
        <Button variant={slow ? 'secondary' : 'ghost'} onClick={() => setSlow((v) => !v)} aria-pressed={slow}>
          <Snail />
          慢速
        </Button>
      </div>
    </div>
  );
};

// ==================== 选词填空空位 ====================

const ClozeBlank: React.FC<{
  index: number;
  value: string;
  bank: string[];
  used: Set<string>;
  result?: ClozeResult;
  /** 提交时还没填（标红提示） */
  missing?: boolean;
  /** 用于提交时定位到第一个没作答的空 */
  id?: string;
  onFill: (word: string) => void;
}> = ({ index, value, bank, used, result, missing, id, onFill }) => {
  if (result) {
    return result.correct ? (
      <span className="rounded bg-success-soft px-1.5 font-medium text-success">{result.answer}</span>
    ) : (
      <span className="rounded bg-destructive/10 px-1.5">
        {result.given && <span className="mr-1 text-destructive line-through">{result.given}</span>}
        <span className="font-medium text-success">{result.answer}</span>
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          id={id}
          type="button"
          className={cn(
            'mx-0.5 inline-flex min-w-20 items-baseline justify-center rounded-md border-b-2 px-2 align-baseline outline-none transition-colors select-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            value ? 'border-primary bg-accent font-medium text-accent-foreground' : 'border-muted-foreground/40 bg-muted text-muted-foreground hover:bg-accent',
            missing && 'border-destructive bg-destructive/10 text-destructive hover:bg-destructive/15',
          )}
          aria-label={`第 ${index + 1} 空${value ? `：${value}` : missing ? '：还没有填' : ''}`}
          aria-invalid={missing || undefined}
        >
          {value || `(${index + 1})`}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {bank.map((w) => (
          <DropdownMenuItem key={w} onSelect={() => onFill(w)} disabled={used.has(w.toLowerCase()) && w !== value}>
            {w}
          </DropdownMenuItem>
        ))}
        {value && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onFill('')}>清空</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

// ==================== 题目 ====================

const QuestionItem: React.FC<{
  index: number;
  question: PassageQuestion;
  value: string;
  onChange: (value: string) => void;
  result?: QuestionResult;
  /** 提交时还没作答（标红并提示） */
  missing?: boolean;
  /** 用于提交时定位到第一道没作答的题 */
  id?: string;
}> = ({ index, question, value, onChange, result, missing, id }) => {
  const done = Boolean(result);
  const badge =
    result?.correct === true ? (
      <Badge className="bg-success-soft text-success">
        <Check />
        正确
      </Badge>
    ) : result?.correct === false ? (
      <Badge variant="destructive">
        <X />
        错误
      </Badge>
    ) : result?.score != null ? (
      <Badge variant="secondary">{result.score} / 4 分</Badge>
    ) : null;
  const kindLabel = question.kind === 'true_false' ? '判断' : question.kind === 'open' ? '开放题' : '选择';

  return (
    <div id={id} className={cn('flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors', missing && 'border-destructive')} aria-invalid={missing || undefined}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums select-none">{index}</span>
        <div className="min-w-0 flex-1 font-medium">
          <span className="mr-1.5 text-xs font-normal text-muted-foreground select-none">{kindLabel}</span>
          {question.stem}
        </div>
        {badge}
      </div>

      {question.kind === 'choice' && (
        <RadioGroup value={value} onValueChange={onChange} disabled={done} className="gap-1.5 pl-8">
          {question.options.map((option, i) => {
            const isAnswer = done && question.answer === String(i);
            const isWrongPick = done && value === String(i) && !isAnswer;
            return (
              <Label
                key={i}
                className={cn(
                  'flex items-center gap-2.5 rounded-md border px-3 py-2 font-normal transition-colors hover:bg-muted/60',
                  value === String(i) && !done && 'border-primary bg-accent/50',
                  isAnswer && 'border-success/40 bg-success-soft',
                  isWrongPick && 'border-destructive/40 bg-destructive/10',
                )}
              >
                <RadioGroupItem value={String(i)} />
                <span className="text-muted-foreground">{String.fromCharCode(65 + i)}.</span>
                {option}
              </Label>
            );
          })}
        </RadioGroup>
      )}

      {question.kind === 'true_false' && (
        <ToggleGroup type="single" value={value} onValueChange={(v) => v && onChange(v)} disabled={done} className="ml-8 w-fit rounded-lg bg-muted p-0.5" aria-label="判断">
          {[
            ['true', '正确 True'],
            ['false', '错误 False'],
          ].map(([v, label]) => (
            <ToggleGroupItem
              key={v}
              value={v}
              className={cn('h-8 rounded-md px-4 data-[state=on]:bg-background data-[state=on]:shadow-sm', done && question.answer === v && 'text-success')}
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      {question.kind === 'open' && (
        <div className="pl-8">
          {done ? (
            <p className="rounded-md bg-muted/60 px-3 py-2 whitespace-pre-wrap select-text">{value || <span className="text-muted-foreground">（没有作答）</span>}</p>
          ) : (
            <>
              <Textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                maxLength={OPEN_MAX}
                placeholder="用英文回答"
                className="min-h-24 resize-none"
                aria-invalid={missing || undefined}
              />
              <p className="mt-1 text-right text-xs text-muted-foreground tabular-nums">
                {value.length} / {OPEN_MAX}
              </p>
            </>
          )}
        </div>
      )}

      {missing && (
        <p className="ml-8 flex items-center gap-1.5 text-sm text-destructive" role="alert">
          <CircleAlert className="size-4" />
          还没有作答
        </p>
      )}

      {done && (question.explanation || result?.feedback || question.referenceAnswer) && (
        <div className="ml-8 flex flex-col gap-1.5 rounded-md bg-muted/40 px-3 py-2 text-sm select-text">
          {question.kind !== 'open' && question.explanation && <p className="text-muted-foreground">解析：{question.explanation}</p>}
          {question.kind === 'open' && (
            <>
              {result?.feedback && (
                <p>
                  <Sparkles className="mr-1 inline size-3.5 text-primary" />
                  {result.feedback}
                </p>
              )}
              {result?.suggestion && <p className="text-muted-foreground">可以这样说：{result.suggestion}</p>}
              {question.referenceAnswer && <p className="text-muted-foreground">参考答案：{question.referenceAnswer}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ==================== 页面 ====================

/**
 * 按题组练习（专注模式整窗页面）。阅读：看着原文做选词填空与阅读题；听力：逐句听（不看原文、不考选词填空）。
 * 提交后同页显示对错、解析、开放题评分与评语，并展开原文与翻译。
 */
export const PassagePracticePage: React.FC<PassagePracticePageProps> = ({ setId, mode = 'reading', planId, returnTo, onNavigate }) => {
  const [set, setSet] = useState<QuestionSet | null>(null);
  const [passage, setPassage] = useState<Passage | null>(null);
  /** 视频切片：听力用原声 */
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<PassageAttempt | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [regrading, setRegrading] = useState(false);
  const [submitError, setSubmitError] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [showZh, setShowZh] = useState(false);
  /** 点过提交但还有题没作答：标出没作答的题 */
  const [showMissing, setShowMissing] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const startedAt = useRef(Date.now());
  const [now, setNow] = useState(Date.now());

  const finished = attempt?.status === 'completed';

  const load = useCallback(async () => {
    if (!setId) return setLoadError('缺少题组');
    setLoadError(null);
    const s = await passageService.getQuestionSet(setId);
    if (!s.success) return setLoadError(s.error);
    const [p, a] = await Promise.all([passageService.getPassage(s.data.passageId), passageService.startAttempt(setId, mode, planId)]);
    if (!p.success) return setLoadError(p.error);
    if (!a.success) return setLoadError(a.error);
    setSet(s.data);
    setPassage(p.data);
    if (p.data.origin === 'video') {
      const v = await videoService.getPassageVideo(p.data.id);
      setClipUrl(v.success ? (v.data?.clipUrl ?? null) : null);
    }
    setAttempt(a.data);
    setAnswers({});
    setSubmitError(null);
    setShowMissing(false);
    startedAt.current = Date.now();
  }, [setId, mode, planId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (finished) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [finished]);

  const texts = useMemo(() => passage?.sentences.map((s) => s.en) ?? [], [passage]);
  const clozeQuestions = useMemo(() => (mode === 'reading' ? (set?.questions.filter((q) => q.kind === 'cloze') ?? []) : []), [set, mode]);
  const otherQuestions = useMemo(() => set?.questions.filter((q) => q.kind !== 'cloze') ?? [], [set]);

  const back = () => {
    if (returnTo === 'plan-detail' && planId) return onNavigate?.('plan-detail', { planId, tab: 'passages' });
    if (returnTo === 'home') return onNavigate?.('home');
    if (returnTo === 'calendar') return onNavigate?.('calendar');
    return passage ? onNavigate?.('passage-detail', { passageId: passage.id, clip: passage.origin === 'video' || undefined }) : onNavigate?.('passages');
  };
  /** back() 去向的按钮文案 */
  const backLabel =
    returnTo === 'plan-detail' && planId ? '返回计划'
    : returnTo === 'home' ? '返回首页'
    : returnTo === 'calendar' ? '返回日历'
    : passage ? '返回短文' : '返回短文库';
  const dirty = !finished && Object.values(answers).some((v) => v.trim());
  const requestExit = () => (dirty ? setConfirmExit(true) : back());
  const setAnswer = (id: number, value: string) => setAnswers((prev) => ({ ...prev, [id]: value }));

  const submit = async () => {
    if (!set || !attempt) return;
    // 必须全部作答：标出没作答的题，定位并聚焦第一道
    const firstMissing = [...clozeQuestions, ...otherQuestions].find((q) => !(answers[q.id] ?? '').trim());
    if (firstMissing) {
      setShowMissing(true);
      setSubmitError(null);
      const el = document.getElementById(questionDomId(firstMissing.id));
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const focusable = el?.matches('button') ? el : el?.querySelector<HTMLElement>('textarea, button:not([disabled])');
      focusable?.focus({ preventScroll: true });
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const result = await passageService.submitAttempt({
      attemptId: attempt.id,
      activeTime: Date.now() - startedAt.current,
      answers: [...clozeQuestions, ...otherQuestions].map((q) => ({
        questionId: q.id,
        value: answers[q.id] ?? '',
      })),
    });
    setSubmitting(false);
    if (result.success) setAttempt(result.data);
    else setSubmitError({ title: '无法提交答案', message: result.error });
  };

  const regrade = async () => {
    if (!attempt) return;
    setRegrading(true);
    const result = await passageService.regradeOpen(attempt.id);
    setRegrading(false);
    if (result.success) setAttempt(result.data);
    else setSubmitError({ title: '无法重新评分', message: result.error });
  };

  const restart = (nextMode: PassageMode) => {
    if (!set) return;
    if (nextMode === mode) load();
    // 计划只安排了一种方式：换方式是自由练习，不计入计划
    else onNavigate?.('passage-practice', { setId: set.id, mode: nextMode });
  };

  const total = clozeQuestions.length + otherQuestions.length;
  const isMissing = (id: number) => showMissing && !finished && !(answers[id] ?? '').trim();
  const answered = [...clozeQuestions, ...otherQuestions].filter((q) => (answers[q.id] ?? '').trim()).length;

  const frame = (content: React.ReactNode) => (
    <div className="flex h-svh flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b px-4 select-none">
        <Button variant="ghost" size="icon" aria-label="退出练习" title="退出练习" onClick={requestExit}>
          <X />
        </Button>
        <span className="text-sm font-medium">{MODE_LABEL[mode]}练习</span>
        {passage && set && (
          <span className="truncate text-sm text-muted-foreground">
            {passage.title} · {set.name}
          </span>
        )}
        {set && !finished && (
          <div className="mx-auto flex max-w-xs flex-1 items-center gap-3" title="已作答 / 全部题目">
            <Progress value={total ? (answered / total) * 100 : 0} className="h-2 flex-1 [&>[data-slot=progress-indicator]]:bg-brand" />
            <span className="text-sm tabular-nums">
              {answered} / {total}
            </span>
          </div>
        )}
        {set && !finished && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums" title="用时">
            <Clock className="size-4" />
            {formatDuration(now - startedAt.current, 'clock')}
          </span>
        )}
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">{content}</main>
    </div>
  );

  if (loadError) {
    return frame(
      <div className="mx-auto w-full max-w-2xl px-8 py-10">
        <PageError
          title="无法打开这套题"
          message={loadError}
          onRetry={load}
          back={{ label: backLabel, onClick: back }}
        />
      </div>,
    );
  }
  if (!set || !passage || !attempt) {
    return frame(
      <div className="flex h-full items-center justify-center text-muted-foreground" role="status">
        <Loader2 className="mr-2 size-5 animate-spin" />
        正在打开…
      </div>,
    );
  }

  const clozeResultOf = (id: number) => attempt.clozeResults.find((r) => r.questionId === id);
  const resultOf = (id: number) => attempt.questionResults.find((r) => r.questionId === id);
  const valueOf = (q: PassageQuestion) => (finished ? ((q.kind === 'cloze' ? clozeResultOf(q.id)?.given : resultOf(q.id)?.given) ?? '') : (answers[q.id] ?? ''));
  const usedWords = new Set(clozeQuestions.map((q) => (answers[q.id] ?? '').toLowerCase()).filter(Boolean));
  const blankNumber = new Map(clozeQuestions.map((q, i) => [q.id, i]));

  /** 阅读模式的正文：选词填空的句子按空位拆开 */
  const renderSentence = (index: number) => {
    const blanks = clozeQuestions.filter((q) => q.sentenceIndex === index).map((q) => ({ questionId: q.id, word: q.answer ?? q.stem }));
    if (blanks.length === 0) return passage.sentences[index].en;
    return splitWithBlanks(passage.sentences[index].en, blanks).map((part, j) => {
      if (part.kind === 'text') return <React.Fragment key={j}>{part.text}</React.Fragment>;
      const question = clozeQuestions.find((q) => q.id === part.questionId);
      return (
        <ClozeBlank
          key={j}
          index={blankNumber.get(part.questionId) ?? 0}
          value={question ? valueOf(question) : ''}
          bank={set.clozeBank}
          used={usedWords}
          result={finished ? clozeResultOf(part.questionId) : undefined}
          missing={isMissing(part.questionId)}
          id={questionDomId(part.questionId)}
          onFill={(w) => setAnswer(part.questionId, w)}
        />
      );
    });
  };

  const showText = mode === 'reading' || finished;

  return frame(
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-8 py-6">
      {finished && (
        <Card className="flex-row items-center gap-6 px-5 py-4">
          <div className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
            <Check className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">完成 · {scoreSummary(attempt)}</div>
            <div className="text-sm text-muted-foreground">
              用时 {formatDuration(attempt.activeTime)}
            </div>
            {attempt.gradingError && (
              <div className="mt-1 flex items-center gap-2 text-sm text-warning">
                <AlertTriangle className="size-4" />
                {attempt.gradingError}
                <Button variant="outline" size="sm" className="h-7" onClick={regrade} disabled={regrading}>
                  {regrading ? <Loader2 className="animate-spin" /> : <RotateCw />}
                  重新评分
                </Button>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => restart('reading')}>
              <BookOpen />
              {mode === 'reading' ? '再做一次' : '阅读练习'}
            </Button>
            <Button variant="outline" onClick={() => restart('listening')}>
              <Headphones />
              {mode === 'listening' ? '再听一次' : '听力练习'}
            </Button>
            <Button onClick={back}>{returnTo === 'plan-detail' && planId ? '回到计划' : '完成'}</Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 items-start gap-6">
        <section className="sticky top-0 flex flex-col gap-4 rounded-xl border bg-card p-6">
          <div className="flex items-center gap-2 select-none">
            <h2 className="flex-1 text-xl font-semibold">{showText ? passage.title : '听一听'}</h2>
            {showText && (
              <div className="flex items-center gap-2">
                <Switch id="pp-zh" checked={showZh} onCheckedChange={setShowZh} disabled={!finished} />
                <Label htmlFor="pp-zh" className={cn(!finished && 'text-muted-foreground')}>
                  <Languages className="size-4" />
                  {finished ? '显示翻译' : '提交后可看翻译'}
                </Label>
              </div>
            )}
          </div>
          {mode === 'listening' && <ListeningPlayer texts={texts} clip={clipUrl && passage ? { url: clipUrl, sentences: passage.sentences } : undefined} />}
          {showText && <PassageReader sentences={passage.sentences} translation={showZh ? 'all' : 'off'} renderSentence={mode === 'reading' ? renderSentence : undefined} />}
          {mode === 'reading' && !finished && clozeQuestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t pt-3 select-none">
              <span className="mr-1 text-xs text-muted-foreground">点空位选词</span>
              {set.clozeBank.map((w) => (
                <span key={w} className={cn('rounded-full border px-2.5 py-0.5 text-sm', usedWords.has(w.toLowerCase()) && 'line-through opacity-40')}>
                  {w}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          {otherQuestions.map((q, i) => (
            <QuestionItem
              key={q.id}
              id={questionDomId(q.id)}
              index={i + 1}
              question={q}
              value={valueOf(q)}
              result={finished ? resultOf(q.id) : undefined}
              missing={isMissing(q.id)}
              onChange={(v) => setAnswer(q.id, v)}
            />
          ))}
          {otherQuestions.length === 0 && (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">在左边的原文里作答</p>
          )}
          {showMissing && !finished && answered < total && (
            <InlineError title={`还有 ${total - answered} 题没有作答`}>
              标红的题目答完才能提交
            </InlineError>
          )}
          {submitError && <InlineError title={submitError.title}>{submitError.message}</InlineError>}
          {!finished && (
            <div className="flex items-center justify-end gap-3 pt-1">
              <span className="text-sm text-muted-foreground tabular-nums">
                已答 {answered} / {total}
              </span>
              <Button size="lg" onClick={submit} disabled={submitting}>
                {submitting && <Loader2 className="animate-spin" />}
                {submitting ? '正在判分…' : '提交'}
              </Button>
            </div>
          )}
        </section>
      </div>

      <AlertDialog open={confirmExit} onOpenChange={setConfirmExit}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>退出这次练习？</AlertDialogTitle>
            <AlertDialogDescription>已经填写的答案不会保存，下次打开会重新开始。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续练习</AlertDialogCancel>
            <AlertDialogAction onClick={back}>退出</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>,
  );
};
