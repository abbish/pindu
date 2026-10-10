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
  Volume2,
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
const NO_TEXTS: string[] = [];

/**
 * 逐句听（播放条）：上一句 / 播放·暂停 / 下一句 → 句子进度（每段一句，可点哪句听哪句）→ 重听本句、慢速。
 * 答题时不显示原文。视频切片用原声，其余用合成语音。
 */
/** 逐句播放器（合成语音与视频原声两种实现的共同部分） */
interface ListeningPlayerHandle {
  current: number | null;
  playing: boolean;
  loading: boolean;
  play: (index: number, onlyThis?: boolean) => unknown;
  stop: () => void;
}

const ListeningPlayer: React.FC<{ player: ListeningPlayerHandle; total: number; slow: boolean; onSlowChange: (slow: boolean) => void }> = ({ player, total, slow, onSlowChange }) => {
  const texts = Array.from({ length: total });
  const current = player.current ?? 0;
  const go = (delta: number) => player.play(Math.min(texts.length - 1, Math.max(0, current + delta)), true);
  return (
    <div className="flex items-center gap-3 select-none">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="上一句" onClick={() => go(-1)} disabled={current === 0}>
          <ChevronLeft />
        </Button>
        <Button size="icon" className="size-10 rounded-full" aria-label={player.playing ? '暂停' : '播放'} onClick={() => (player.playing ? player.stop() : player.play(current))}>
          {player.loading ? <Loader2 className="animate-spin" /> : player.playing ? <Pause /> : <Play />}
        </Button>
        <Button variant="ghost" size="icon" aria-label="下一句" onClick={() => go(1)} disabled={current >= texts.length - 1}>
          <ChevronRight />
        </Button>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Headphones className="size-3.5" />第 {current + 1} / {texts.length} 句
        </div>
        <div className="flex gap-1">
          {texts.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`听第 ${i + 1} 句`}
              onClick={() => player.play(i, true)}
              className={cn('h-2 flex-1 rounded-full transition-colors hover:bg-primary/70', i < current ? 'bg-primary/40' : i === current ? 'bg-primary' : 'bg-border')}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => player.play(current, true)}>
          <RotateCcw />
          重听本句
        </Button>
        <Button variant={slow ? 'secondary' : 'ghost'} size="sm" onClick={() => onSlowChange(!slow)} aria-pressed={slow}>
          <Snail />
          慢速
        </Button>
      </div>
    </div>
  );
};

// ==================== 选词填空 ====================

/**
 * 原文里的空位：点一下选中它（当前空位高亮），再在「选词填空」卡片的词库里点词填入。
 * 交卷后显示对错（错的划掉，标出正确答案）。
 */
const ClozeBlank: React.FC<{
  index: number;
  value: string;
  /** 当前要填的空 */
  active: boolean;
  result?: ClozeResult;
  /** 提交时还没填（标红提示） */
  missing?: boolean;
  /** 用于提交时定位到第一个没作答的空 */
  id?: string;
  onActivate: () => void;
}> = ({ index, value, active, result, missing, id, onActivate }) => {
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
    <button
      id={id}
      type="button"
      onClick={onActivate}
      className={cn(
        'mx-0.5 inline-flex min-w-20 items-baseline justify-center rounded-md border-b-2 border-dashed px-2 align-baseline outline-none transition-colors select-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        value ? 'border-solid border-primary bg-accent font-medium text-accent-foreground' : 'border-muted-foreground/50 bg-muted text-muted-foreground hover:bg-accent',
        active && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
        missing && 'border-destructive bg-destructive/10 text-destructive hover:bg-destructive/15',
      )}
      aria-label={`第 ${index + 1} 空${value ? `：${value}` : missing ? '：还没有填' : ''}`}
      aria-pressed={active}
      aria-invalid={missing || undefined}
    >
      {value || `(${index + 1})`}
    </button>
  );
};

/**
 * 「选词填空」卡片（题目列表第一张）：各空位（点选切换）→ 词库（点词填入当前空，自动跳到下一个没填的空）。
 * 一个词只能用一次，用过的灰掉；当前空已填时可以清空。
 */
const ClozeCard: React.FC<{
  blanks: { id: number; value: string; missing: boolean }[];
  activeId: number | null;
  bank: string[];
  used: Set<string>;
  onActivate: (id: number) => void;
  onPick: (word: string) => void;
  onClear: () => void;
  /** 嵌在别的区块里（听句填空）：不画外框与标题 */
  embedded?: boolean;
}> = ({ blanks, activeId, bank, used, onActivate, onPick, onClear, embedded }) => {
  const activeIndex = blanks.findIndex((b) => b.id === activeId);
  const active = blanks[activeIndex];
  const body = (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {blanks.map((b, i) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onActivate(b.id)}
            className={cn(
              'h-8 min-w-12 rounded-md border px-2.5 text-sm tabular-nums transition-colors',
              b.value ? 'border-primary/50 bg-accent text-accent-foreground' : 'border-dashed text-muted-foreground',
              b.id === activeId && 'ring-2 ring-primary',
              b.missing && 'border-destructive text-destructive'
            )}
            aria-pressed={b.id === activeId}
          >
            ({i + 1}){b.value && ` ${b.value}`}
          </button>
        ))}
        {active?.value && (
          <Button variant="ghost" size="sm" className="h-8" onClick={onClear}>
            清空第 {activeIndex + 1} 空
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t pt-3">
        {bank.map((w) => {
          const taken = used.has(w.toLowerCase()) && w.toLowerCase() !== active?.value.toLowerCase();
          return (
            <Button key={w} variant="outline" size="sm" className="h-9 rounded-full px-4 text-base" disabled={taken || !active} onClick={() => onPick(w)}>
              {w}
            </Button>
          );
        })}
      </div>
    </>
  );
  if (embedded) return <div className="flex flex-col gap-3">{body}</div>;
  return (
    <Card className="gap-3 px-5 py-4">
      <div className="flex items-baseline gap-2">
        <h3 className="font-semibold">选词填空</h3>
        <span className="text-sm text-muted-foreground">{active ? `正在填第 ${activeIndex + 1} 空` : `${blanks.length} 空`}</span>
      </div>
      {body}
    </Card>
  );
};

// ==================== 题目 ====================

/** 比较用：小写、只留字母数字 */
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * 「参考表达」是在学生原回答基础上改好的一句：0 分（空白、非英文、答非所问）没有可改的，
 * 或与参考答案基本相同时不再显示，避免与「参考答案」重复。
 */
const showSuggestion = (suggestion: string, score: number | null, reference?: string | null) => {
  if (score === 0) return false;
  if (!reference) return true;
  const a = normalize(suggestion);
  const b = normalize(reference);
  return a !== b && !a.includes(b) && !b.includes(a);
};

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
  const kindLabel = question.kind === 'true_false' ? '判断题' : question.kind === 'open' ? '开放题' : '选择题';

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
              {result?.suggestion && showSuggestion(result.suggestion, result.score, question.referenceAnswer) && <p className="text-muted-foreground">参考表达：{result.suggestion}</p>}
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
 * 按题组练习（专注模式整窗页面）。阅读：看着原文做选词填空与阅读题；听力：逐句听（不看原文），选词填空为「听句填空」（只显示所在句子并挖空）。
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
  /** 选词填空当前选中的空（null = 第一个没填的空） */
  const [activeBlank, setActiveBlank] = useState<number | null>(null);
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
  /** 听力播放：视频切片用原声，其余用合成语音（播放条与听句填空共用） */
  const [slow, setSlow] = useState(false);
  const tts = useSentencePlayer(mode === 'listening' && !clipUrl ? texts : NO_TEXTS, { speed: slow ? 'slow' : 'normal' });
  const original = useClipSentencePlayer(mode === 'listening' ? clipUrl : null, passage?.sentences ?? NO_SENTENCES, { slow });
  const listenPlayer: ListeningPlayerHandle = clipUrl ? original : tts;
  const clozeQuestions = useMemo(() => set?.questions.filter((q) => q.kind === 'cloze') ?? [], [set]);
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
  /** 当前要填的空：没选过时是第一个没填的空 */
  const currentBlank = activeBlank ?? clozeQuestions.find((q) => !(answers[q.id] ?? '').trim())?.id ?? clozeQuestions[0]?.id ?? null;
  /** 点词：填入当前空，跳到下一个没填的空（往后找，找不到从头找） */
  const pickWord = (word: string) => {
    if (currentBlank === null) return;
    setAnswer(currentBlank, word);
    const order = clozeQuestions.map((q) => q.id);
    const from = order.indexOf(currentBlank);
    const rest = [...order.slice(from + 1), ...order.slice(0, from)];
    const next = rest.find((id) => !(answers[id] ?? '').trim());
    setActiveBlank(next ?? currentBlank);
  };
  const clozeCard = (embedded = false) =>
    clozeQuestions.length > 0 && !finished ? (
      <ClozeCard
        embedded={embedded}
        blanks={clozeQuestions.map((q) => ({ id: q.id, value: answers[q.id] ?? '', missing: isMissing(q.id) }))}
        activeId={currentBlank}
        bank={set.clozeBank}
        used={usedWords}
        onActivate={(id) => {
          setActiveBlank(id);
          document.getElementById(questionDomId(id))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}
        onPick={pickWord}
        onClear={() => currentBlank !== null && setAnswer(currentBlank, '')}
      />
    ) : null;

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
          active={!finished && currentBlank === part.questionId}
          result={finished ? clozeResultOf(part.questionId) : undefined}
          missing={isMissing(part.questionId)}
          id={questionDomId(part.questionId)}
          onActivate={() => setActiveBlank(part.questionId)}
        />
      );
    });
  };

  const showText = mode === 'reading' || finished;
  /** 听力作答中（不看原文）：单栏布局 */
  const listeningOnly = mode === 'listening' && !showText;

  const questionsSection = (
        <section className="flex flex-col gap-3">
          {mode === 'reading' && clozeCard()}
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
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">请在原文中作答</p>
          )}
          {showMissing && !finished && answered < total && (
            <InlineError title={`还有 ${total - answered} 题未作答`}>
              请完成标红的题目后提交
            </InlineError>
          )}
          {submitError && <InlineError title={submitError.title}>{submitError.message}</InlineError>}
          {!finished && (
            <div className="flex items-center justify-end gap-3 pt-1">
              <span className="text-sm text-muted-foreground tabular-nums">
                已答 {answered} / {total}
              </span>
              {/* 尺寸固定、不做过渡：提交中切换文字与禁用态时 WebKit 不会留下上一个状态的残影 */}
              <Button size="lg" className="min-w-32 transition-none" onClick={submit} disabled={submitting}>
                {submitting && <Loader2 className="animate-spin" />}
                {submitting ? '正在判分…' : '提交'}
              </Button>
            </div>
          )}
        </section>
  );

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
            <Button onClick={back}>{returnTo === 'plan-detail' && planId ? '返回计划' : '完成'}</Button>
          </div>
        </Card>
      )}

      {listeningOnly ? (
        // 听力作答：单栏居中，播放条吸顶（随时能听），下沿是题号（已答点亮，点击跳到该题）
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <div className="sticky top-0 z-10 space-y-3 rounded-xl border bg-card/95 p-3 shadow-sm backdrop-blur">
            <ListeningPlayer player={listenPlayer} total={texts.length} slow={slow} onSlowChange={setSlow} />
            {otherQuestions.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5 border-t pt-2.5">
                {otherQuestions.map((q, i) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => document.getElementById(questionDomId(q.id))?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                    className={cn(
                      'size-7 rounded-full border text-xs tabular-nums transition-colors hover:border-primary',
                      valueOf(q) ? 'border-primary bg-primary text-primary-foreground' : 'bg-background text-muted-foreground',
                      isMissing(q.id) && 'border-destructive text-destructive'
                    )}
                    aria-label={`第 ${i + 1} 题${valueOf(q) ? '（已作答）' : ''}`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
          {clozeQuestions.length > 0 && (
            // 听句填空：只显示有空位的句子，听这一句，从词库里选词
            <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
              <h3 className="font-semibold">听句填空</h3>
              {[...new Set(clozeQuestions.map((q) => q.sentenceIndex ?? 0))]
                .sort((x, y) => x - y)
                .map((idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <Button variant="ghost" size="icon" className="shrink-0" aria-label={`听第 ${idx + 1} 句`} onClick={() => listenPlayer.play(idx, true)}>
                      <Volume2 />
                    </Button>
                    <p className="pt-1.5 text-lg leading-loose">{renderSentence(idx)}</p>
                  </div>
                ))}
              {clozeCard(true)}
            </section>
          )}
          {questionsSection}
        </div>
      ) : (
      <div className="grid grid-cols-2 items-start gap-6">
        <section className="sticky top-0 flex flex-col gap-4 rounded-xl border bg-card p-6">
          <div className="flex items-center gap-2 select-none">
            <h2 className="flex-1 text-xl font-semibold">{showText ? passage.title : '听力'}</h2>
            {showText && (
              <div className="flex items-center gap-2">
                <Switch id="pp-zh" checked={showZh} onCheckedChange={setShowZh} disabled={!finished} />
                <Label htmlFor="pp-zh" className={cn(!finished && 'text-muted-foreground')} title={finished ? undefined : '提交后可查看'}>
                  <Languages className="size-4" />
                  译文
                </Label>
              </div>
            )}
          </div>
          {showText && <PassageReader sentences={passage.sentences} translation={showZh ? 'all' : 'off'} renderSentence={mode === 'reading' || finished ? renderSentence : undefined} />}
        </section>

        {questionsSection}
      </div>
      )}

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
