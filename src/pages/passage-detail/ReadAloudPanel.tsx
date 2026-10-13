import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brain, ChevronLeft, ChevronRight, EyeOff, Loader2, Mic, Pause, Play, Settings2, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PassageReader, type TranslationMode } from '@/components/PassageReader';
import { TargetWord } from '@/components/PassageReader/WordCard';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { SelectionAction } from '@/components/SelectionAction';
import { useTargetWordInfo } from './useTargetWordInfo';
import { useSentencePlayer } from '@/hooks/useSentencePlayer';
import { useRecorder } from '@/hooks/useRecorder';
import { usePronunciation } from '@/hooks/usePronunciation';
import { SayText, SayVerdict } from '@/components/SayText';
import type { Assessment, PronunciationContext } from '@/types/pronunciation';
import { cn } from '@/lib/utils';
import { canAddTarget, formsOf, recallBlanks } from '@/utils/passage';
import { SentenceAnalysisPanel } from '@/components/SentenceAnalysis';
import type { SpeechSpeed } from '@/services/ttsService';
import type { Passage } from '@/types/passage';

/** 朗读偏好（记住） */
interface ReadAloudPrefs {
  speed: SpeechSpeed;
  /** 每句读几遍 */
  repeat: number;
  /** 句间停顿（毫秒） */
  pauseMs: number;
  translation: TranslationMode;
  /** 标出目标词 */
  highlight: boolean;
  /** 听后回忆：读完含目标词的句子后，把目标词挖空让学生选 */
  recall: boolean;
  /** 聚焦朗读：当前句最清晰，上下文逐渐模糊 */
  focusBlur: boolean;
  /** 每句跟读：每句读完后开麦跟读，本机评估后逐词标色 */
  shadow: boolean;
}

const PREFS_KEY = 'passage.readAloud.v2';
const DEFAULT_PREFS: ReadAloudPrefs = { speed: 'normal', repeat: 1, pauseMs: 0, translation: 'off', highlight: true, recall: false, focusBlur: true, shadow: false };
const segmentItem = 'h-7 rounded-md px-2.5 text-xs data-[state=on]:bg-background data-[state=on]:shadow-sm';

function readPrefs(): ReadAloudPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    // 存储不可用时用默认值
  }
  return DEFAULT_PREFS;
}

/** 听后回忆：某句里的目标词挖空，从词库里点选填回 */
interface RecallState {
  index: number;
  /** 空位答案（原文写法，按出现顺序） */
  answers: string[];
  filled: string[];
  bank: string[];
  /** 刚点错的词（短暂标红） */
  wrong: string | null;
  revealed: boolean;
  resolve: () => void;
}

const shuffle = <T,>(list: T[]) => {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/** 一段设置：标题 + 分段选择 */
const SettingRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-3">
    <Label className="text-sm font-normal">{label}</Label>
    {children}
  </div>
);

/**
 * 短文朗读面板（短文详情「原文」页签）：
 * 朗读全文 / 单句，逐词高亮并在读到目标词时放大提示；点目标词看单词卡片；
 * 设置：慢速、每句读几遍、句间停顿（跟读）、翻译显示（不显示 / 当前句 / 全部）、听后回忆、标出目标词；盲听（先听再看原文）。
 */
/** 选中的文字是一个英文单词（可以加成目标词） */
/** 选中的文字是一个英文单词或 2–6 个词的词组（可以加成目标词） */

/** onAddTarget：读的时候选中原文里的一个词，加成这篇的目标词 */
export const ReadAloudPanel: React.FC<{
  passage: Passage;
  onAddTarget?: (word: string, stay?: boolean, form?: string) => void;
  onOpenWord?: (word: string) => void;
  /** 句子分析里改译文；失败时返回原因 */
  onEditTranslation?: (index: number, zh: string) => Promise<string | null>;
  /** 学习计划里朗读时带上：跟读评估的结果保存进计划的发音统计 */
  pronunciationContext?: PronunciationContext;
}> = ({ passage, onAddTarget, onOpenWord, onEditTranslation, pronunciationContext }) => {
  const [prefs, setPrefs] = useState<ReadAloudPrefs>(readPrefs);
  const [blind, setBlind] = useState(false);
  const [blindDone, setBlindDone] = useState(false);
  const [recall, setRecall] = useState<RecallState | null>(null);
  const details = useTargetWordInfo(passage);
  const wordAudio = useAudioPlayer();

  const targets = useMemo(() => passage.targetWords.map((w) => w.word), [passage]);
  /** 目标词组在原文里的写法（拆开用的词组按它标出、挖空） */
  const forms = useMemo(() => formsOf(passage.targetWords), [passage]);
  const texts = useMemo(() => passage.sentences.map((s) => s.en), [passage]);
  /** 正在看分析的句子 */
  const [analyzing, setAnalyzing] = useState<number | null>(null);

  // 跟读评估：朗读完一句 → 开麦 → 学习者跟读 → 本机评估，结果留在这句下面
  const say = usePronunciation(pronunciationContext);
  const recorder = useRecorder({ silenceStopMs: 900, maxMs: 15000 });
  const [shadowing, setShadowing] = useState<{ index: number; resolve: () => void } | null>(null);
  const [sayResults, setSayResults] = useState<Map<number, Assessment>>(new Map());
  const shadowOn = prefs.shadow && say.enabled && say.ready === true;
  const shadowRef = useRef(shadowOn);
  shadowRef.current = shadowOn && !blind;


  const updatePrefs = (patch: Partial<ReadAloudPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // 只影响下次打开时的偏好
    }
  };

  /** 读完一句：开启听后回忆且这句有目标词时，挖空等学生填完再继续 */
  // 盲听与听后回忆时不看句子分析（分析里有整句原文）
  useEffect(() => {
    if (blind || prefs.recall) setAnalyzing(null);
  }, [blind, prefs.recall]);
  const recallRef = useRef(prefs.recall);
  recallRef.current = prefs.recall && !blind;
  const shadowStep = useCallback((index: number) => {
    if (!shadowRef.current) return;
    return new Promise<void>((resolve) => {
      setShadowing({ index, resolve });
      void recorder.start(String(index));
    });
  }, [recorder]);
  const afterSentence = useCallback(
    async (index: number) => {
      await shadowStep(index);
      if (!recallRef.current) return;
      const blanks = recallBlanks(texts[index], targets, forms).flatMap((p) => (p.kind === 'blank' ? [p] : []));
      const answers = blanks.map((b) => b.answer);
      if (answers.length === 0) return;
      const used = new Set(blanks.map((b) => b.target.toLowerCase()));
      const distractors = shuffle(targets.filter((t) => !used.has(t.toLowerCase()))).slice(0, 2);
      return new Promise<void>((resolve) => {
        setRecall({ index, answers, filled: [], bank: shuffle([...new Set(answers), ...distractors]), wrong: null, revealed: false, resolve });
      });
    },
    [texts, targets, forms, shadowStep]
  );

  // 一次跟读录音结束：录到了就评估这句（结果留在句子下面，稍停一下），没录到（太短、麦克风打不开）直接接着朗读
  useEffect(() => {
    if (!shadowing) return;
    const current = shadowing;
    const take = recorder.take;
    const finish = (delay: number) =>
      setTimeout(() => {
        setShadowing((s) => (s === current ? null : s));
        current.resolve();
      }, delay);
    if (!take || take.tag !== String(current.index)) {
      finish(0);
      return;
    }
    void say.assess(take.url, texts[current.index]).then((r) => {
      if (r) setSayResults((m) => new Map(m).set(current.index, r));
      finish(r ? 1200 : 600);
    });
  }, [recorder.ended]);


  const player = useSentencePlayer(texts, {
    speed: prefs.speed,
    repeat: prefs.repeat,
    pauseMs: prefs.pauseMs,
    withTimings: true,
    afterSentence,
    onFinish: () => {
      if (blind) {
        setBlind(false);
        setBlindDone(true);
      }
    },
  });

  // 朗读停下来以后关掉麦克风（指示灯不一直亮着）
  useEffect(() => {
    if (!player.playing && !shadowing) recorder.close();
  }, [player.playing, shadowing]);

  // 播放中改语速：当前这句立刻用新语速从头读（遍数、停顿、听后回忆从这句之后生效）
  const speedRef = useRef(prefs.speed);
  useEffect(() => {
    if (speedRef.current === prefs.speed) return;
    speedRef.current = prefs.speed;
    // 跟读录音时不重读（会被录进去），从下一句开始生效
    if (player.playing && !recall && !shadowing && player.current != null) player.play(player.current);
    // 只响应语速变化
  }, [prefs.speed]);

  /** 结束回忆并继续朗读 */
  const finishRecall = useCallback((state: RecallState, delay: number) => {
    setTimeout(() => {
      setRecall(null);
      state.resolve();
    }, delay);
  }, []);

  const pick = (word: string) => {
    if (!recall || recall.revealed) return;
    const expected = recall.answers[recall.filled.length];
    if (word.toLowerCase() !== expected.toLowerCase()) {
      setRecall({ ...recall, wrong: word });
      return;
    }
    const next = { ...recall, filled: [...recall.filled, expected], wrong: null };
    setRecall(next);
    if (next.filled.length === next.answers.length) finishRecall(next, 900);
  };
  const reveal = () => {
    if (!recall) return;
    const next = { ...recall, filled: recall.answers, revealed: true, wrong: null };
    setRecall(next);
    finishRecall(next, 1800);
  };

  // 停止朗读时一并结束回忆
  const stopAll = () => {
    if (recall) {
      recall.resolve();
      setRecall(null);
    }
    if (shadowing) {
      if (recorder.state !== 'idle') recorder.stop();
      shadowing.resolve();
      setShadowing(null);
    }
    player.stop();
  };

  const toggleBlind = () => {
    stopAll();
    setBlindDone(false);
    setBlind((v) => !v);
  };

  const status = (() => {
    if (shadowing) return recorder.state === 'recording' ? '请跟读' : say.assessing ? '正在评分…' : '准备跟读…';
    if (recall) return '回忆词汇';
    if (player.pausing) return '停顿中，请跟读';
    // 盲听只是隐藏原文，不会自己开始播放：没在播时不显示状态，播放按钮写明「开始盲听」
    if (player.current == null || !player.playing) return blind ? '' : '点击句首图标朗读单句，点击词汇查看单词';
    const round = prefs.repeat > 1 ? ` · 第 ${player.round}/${prefs.repeat} 遍` : '';
    return `第 ${player.current + 1}/${texts.length} 句${round}`;
  })();

  const go = (delta: number) => {
    const next = Math.min(texts.length - 1, Math.max(0, (player.current ?? 0) + delta));
    stopAll();
    player.play(next, true);
  };

  /** 听后回忆：这句的目标词挖空 */
  const renderRecallSentence = (index: number) => {
    if (!recall || recall.index !== index) return undefined;
    let blank = 0;
    return recallBlanks(texts[index], targets, forms).map((t, i) => {
      if (t.kind === 'text') return <React.Fragment key={i}>{t.text}</React.Fragment>;
      const n = blank++;
      const value = recall.filled[n];
      return (
        <span
          key={i}
          className={cn(
            'mx-0.5 inline-flex min-w-16 justify-center rounded-md border-b-2 px-1.5',
            value ? (recall.revealed ? 'border-warning bg-warning-soft text-warning' : 'border-success bg-success-soft text-success') : n === recall.filled.length ? 'border-primary bg-background' : 'border-muted-foreground/40 bg-muted'
          )}
        >
          {value ?? ' '}
        </span>
      );
    });
  };

  /** 句子下面：跟读中的状态，或这句跟读的结果（逐词标色 + 三档 + 怎么读） */
  const shadowPanel = (index: number) => {
    const result = sayResults.get(index);
    const active = shadowing?.index === index;
    if (!active && !result) return null;
    const recording = active && recorder.state !== 'idle';
    return (
      <div className="mt-2 flex flex-col gap-1.5 rounded-lg border bg-background px-3 py-2 text-sm select-none" aria-live="polite">
        {recording ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Mic className="size-4 text-destructive" />
            {recorder.heard ? '在听…' : '请跟读'}
            <span className="flex h-4 items-end gap-0.5" aria-hidden>
              {recorder.live.slice(-12).map((v, i) => (
                <span key={i} className="w-0.5 rounded-full bg-primary" style={{ height: `${Math.max(2, v * 16)}px` }} />
              ))}
            </span>
            <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={recorder.stop}>
              <Square />
              读完了
            </Button>
          </div>
        ) : active && say.assessing ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在评分…
          </div>
        ) : result ? (
          <>
            <SayText text={texts[index]} result={result} strictness={say.strictness} />
            <SayVerdict result={result} strictness={say.strictness} showScore={say.showScore} />
          </>
        ) : (
          active && say.error && <div className="text-muted-foreground">{say.error}</div>
        )}
      </div>
    );
  };

  const recallPanel = (index: number) => {
    if (!recall || recall.index !== index) return null;
    const done = recall.filled.length === recall.answers.length;
    return (
      <div className="mt-3 flex flex-wrap items-center gap-1.5 rounded-lg border bg-background px-3 py-2 text-sm select-none" role="group" aria-label="听后回忆">
        <Brain className="size-4 text-primary" />
        <span className="mr-1 text-muted-foreground">{done ? (recall.revealed ? '已显示答案' : '正确') : '按顺序选择听到的词汇'}</span>
        {!done &&
          recall.bank.map((w) => (
            <Button key={w} variant="outline" size="sm" className={cn('h-7', recall.wrong === w && 'border-destructive text-destructive')} onClick={() => pick(w)}>
              {w}
            </Button>
          ))}
        {!done && (
          <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={reveal}>
            显示答案
          </Button>
        )}
      </div>
    );
  };

  return (
    <Card className="gap-4 px-6 py-5">
      {/* 朗读工具栏 */}
      <div className="flex items-center gap-2 border-b pb-4 select-none">
        <Button onClick={() => (player.playing ? stopAll() : player.play(player.current ?? 0))}>
          {player.playing && player.loading ? <Loader2 className="animate-spin" /> : player.playing ? <Pause /> : <Play />}
          {player.playing ? '暂停' : player.current ? '从这句继续' : blind ? '开始盲听' : '朗读全文'}
        </Button>
        <Button variant="outline" size="icon" aria-label="上一句" onClick={() => go(-1)} disabled={(player.current ?? 0) === 0}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon" aria-label="下一句" onClick={() => go(1)} disabled={(player.current ?? 0) >= texts.length - 1}>
          <ChevronRight />
        </Button>
        {player.loading && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="正在生成语音" />}
        <span className="min-w-0 truncate text-xs text-muted-foreground">{status}</span>
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant={blind ? 'secondary' : 'ghost'} size="sm" onClick={toggleBlind} aria-pressed={blind}>
              <EyeOff />
              盲听
            </Button>
          </TooltipTrigger>
          <TooltipContent>隐藏原文，朗读结束后显示</TooltipContent>
        </Tooltip>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm">
              <Settings2 />
              朗读设置
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="flex w-80 flex-col gap-3">
            <SettingRow label="语速">
              <ToggleGroup type="single" value={prefs.speed} onValueChange={(v) => v && updatePrefs({ speed: v as SpeechSpeed })} className="rounded-lg bg-muted p-0.5">
                <ToggleGroupItem value="normal" className={segmentItem}>
                  常速
                </ToggleGroupItem>
                <ToggleGroupItem value="slow" className={segmentItem}>
                  慢速
                </ToggleGroupItem>
              </ToggleGroup>
            </SettingRow>
            <SettingRow label="每句重复">
              <ToggleGroup type="single" value={String(prefs.repeat)} onValueChange={(v) => v && updatePrefs({ repeat: Number(v) })} className="rounded-lg bg-muted p-0.5">
                {[1, 2, 3].map((n) => (
                  <ToggleGroupItem key={n} value={String(n)} className={segmentItem}>
                    {n} 遍
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </SettingRow>
            <SettingRow label="句间停顿">
              <ToggleGroup type="single" value={String(prefs.pauseMs)} onValueChange={(v) => v && updatePrefs({ pauseMs: Number(v) })} className="rounded-lg bg-muted p-0.5">
                {[
                  [0, '不暂停'],
                  [2000, '2 秒'],
                  [4000, '4 秒'],
                ].map(([v, label]) => (
                  <ToggleGroupItem key={v} value={String(v)} className={segmentItem}>
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </SettingRow>
            <SettingRow label="译文">
              <ToggleGroup type="single" value={prefs.translation} onValueChange={(v) => v && updatePrefs({ translation: v as TranslationMode })} className="rounded-lg bg-muted p-0.5">
                {[
                  ['off', '不显示'],
                  ['current', '当前句'],
                  ['all', '全部'],
                ].map(([v, label]) => (
                  <ToggleGroupItem key={v} value={v} className={segmentItem}>
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </SettingRow>
            {say.enabled && (
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="ra-shadow" className="text-sm font-normal">
                  每句跟读
                </Label>
                {say.ready === false ? (
                  say.downloading ? (
                    <span className="text-xs text-muted-foreground">正在下载评估模型…</span>
                  ) : (
                    <Button variant="outline" size="sm" className="h-7" onClick={() => void say.download()}>
                      下载评估模型
                    </Button>
                  )
                ) : (
                  <Switch id="ra-shadow" checked={prefs.shadow} onCheckedChange={(v) => updatePrefs({ shadow: v })} />
                )}
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="ra-recall" className="text-sm font-normal">
                朗读后回忆词汇
              </Label>
              <Switch id="ra-recall" checked={prefs.recall} onCheckedChange={(v) => updatePrefs({ recall: v })} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="ra-focus" className="text-sm font-normal">
                聚焦当前句
              </Label>
              <Switch id="ra-focus" checked={prefs.focusBlur} onCheckedChange={(v) => updatePrefs({ focusBlur: v })} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="ra-hl" className="text-sm font-normal">
                高亮词汇
              </Label>
              <Switch id="ra-hl" checked={prefs.highlight} onCheckedChange={(v) => updatePrefs({ highlight: v })} />
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {blindDone && !blind && <p className="-mt-1 rounded-md bg-accent/50 px-3 py-1.5 text-xs text-accent-foreground select-none">盲听结束，已显示原文</p>}

      <SelectionAction
        label="加入词汇"
        accept={(text) => Boolean(onAddTarget) && canAddTarget(text, targets)}
        onAction={(text) => onAddTarget?.(text)}
      >
      <PassageReader
        sentences={passage.sentences}
        translation={prefs.translation}
        highlight={prefs.highlight || recall ? targets : []}
        highlightForms={forms}
        current={player.playing || recall ? player.current : null}
        focus={player.current}
        words={player.words}
        timeNowMs={player.timeNowMs}
        onPlaySentence={(i) => {
          stopAll();
          player.play(i, true);
        }}
        hidden={blind}
        focusBlur={prefs.focusBlur}
        renderSentence={renderRecallSentence}
        below={(i) => (
          <>
            {shadowPanel(i)}
            {recallPanel(i)}
          </>
        )}
        onAnalyzeSentence={blind || prefs.recall ? undefined : setAnalyzing}
        analyzing={analyzing}
        renderTarget={(text, target, active) => (
          <TargetWord text={text} target={target} active={active} word={details.get(target.toLowerCase())} speak={(w, slow) => wordAudio.speak(w, { slow })} onOpenCard={onOpenWord ? () => onOpenWord(target) : undefined} />
        )}
      />
      </SelectionAction>
      {analyzing !== null && (
        <SentenceAnalysisPanel passageId={passage.id} sentences={passage.sentences} index={analyzing} onIndexChange={setAnalyzing} targets={targets} onAddTarget={onAddTarget && ((w, form) => onAddTarget(w, true, form))} onEditTranslation={onEditTranslation} onClose={() => setAnalyzing(null)} />
      )}
    </Card>
  );
};
