import React, { useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Eye, Lightbulb, Plus, RotateCcw, Settings2 } from 'lucide-react';
import { SpeakButton } from '@/components/SpeakButton';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { blankCorrect, pickBlanks, type BlankLevel } from '@/utils/dictation';
import { locateWords, markedPieces } from '@/utils/shadowing';
import { sentenceWords } from '@/utils/sentenceBuilder';
import type { PassageSentence } from '@/types/passage';
import { BarIcon, CardShell, NavButton } from './PracticeCard';
import type { SentenceStripProps } from './SentenceStrip';

/** 一句的结果：一次填对 / 改了或看了提示才对 / 看了答案 */
export type DictationResult = 'first' | 'fixed' | 'shown';

const RESULT_LABEL: Record<DictationResult, string> = { first: '一次填对', fixed: '改了才对', shown: '看了答案' };

export interface DictationPanelProps {
  sentences: PassageSentence[];
  /** 练哪些句子（能挖空的，按顺序） */
  order: number[];
  /** 当前句（父组件控制，视频跟着跳） */
  index: number;
  /** 换到第 i 句；play 时接着播这一句 */
  onIndexChange: (index: number, play: boolean) => void;
  /** 播放这一句原声；slow 用慢速 */
  onPlay: (index: number, slow: boolean) => void;
  onStop: () => void;
  playing: 'normal' | 'slow' | null;
  /** 本片段的词汇（优先挖空） */
  vocab: string[];
  /** 挖空多少（换了以后结果清空） */
  level: BlankLevel;
  onLevel: (level: BlankLevel) => void;
  results: Map<number, DictationResult>;
  onResult: (index: number, result: DictationResult) => void;
  /** 再练一遍：清掉这些句子的结果 */
  onReset: (indices: number[]) => void;
  /** 把填错的词加入词汇（能加时才显示） */
  onAddWord?: (word: string) => void;
  canAddWord?: (word: string) => boolean;
}

/** 卡片外壳与底部导航（填空、小结共用） */
interface Frame {
  position: string;
  strip: SentenceStripProps['items'];
  current: number;
  onPick: (index: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
  settings: React.ReactNode;
}

/**
 * 精听：逐句听，每句只填挖掉的几个词（不用整句打字）；挖得少只挖关键词，挖得多还挖读得轻的虚词。
 * 和跟读同一个卡片外壳：顶部固定进度，中间是句子，底部固定控制条（‹ · 播放 · 慢速 · 提示 · 看答案 · 设置 · 核对 / 下一句 · ›）。
 * 填错的标红，改了再核对；卡住时「提示」逐个露出字母，也可以看答案。做完显示整句和译文，填错的词可以加入词汇。
 * 换句都会接着播这一句。全部做完列出结果，可以只重练没一次填对的。
 */
export const DictationPanel: React.FC<DictationPanelProps> = (p) => {
  const { sentences, order: list, index, results } = p;
  const [summary, setSummary] = useState(false);
  /** 重练一次加 1：做过的句子从头开始 */
  const [round, setRound] = useState(0);
  if (list.length === 0) return <p className="p-4 text-sm text-muted-foreground">这个片段没有适合填空的句子</p>;
  const at = list.includes(index) ? list.indexOf(index) : 0;
  const current = list[at];
  const go = (k: number) => {
    setSummary(false);
    if (list[k] !== undefined) p.onIndexChange(list[k], true);
  };
  const first = list.filter((i) => results.get(i) === 'first').length;
  const missed = list.filter((i) => results.has(i) && results.get(i) !== 'first');

  const frame: Frame = {
    position: `第 ${at + 1} / ${list.length} 句`,
    strip: list.map((i) => {
      const r = results.get(i);
      return { index: i, status: r === 'first' ? 'good' : r === 'fixed' ? 'close' : r === 'shown' ? 'retry' : null, label: r && RESULT_LABEL[r] };
    }),
    current,
    onPick: (i) => go(list.indexOf(i)),
    onPrev: at > 0 ? () => go(at - 1) : undefined,
    onNext: at + 1 < list.length ? () => go(at + 1) : undefined,
    settings: <LevelSettings level={p.level} onLevel={p.onLevel} />,
  };

  if (summary) {
    return (
      <CardShell
        position={frame.position}
        strip={frame.strip}
        stripCurrent={frame.current}
        onPick={frame.onPick}
        footer={
          <>
            <NavButton label="上一句" onClick={frame.onPrev}>
              <ChevronLeft />
            </NavButton>
            {frame.settings}
            <span className="ml-auto" />
            <NavButton label="下一句" onClick={frame.onNext}>
              <ChevronRight />
            </NavButton>
          </>
        }
      >
        <div className="space-y-1">
          <p className="font-medium">练完了</p>
          <p className="text-sm text-muted-foreground">
            一次填对 <span className="text-lg font-semibold text-foreground tabular-nums">{first}</span> / {list.length} 句
          </p>
        </div>
        {missed.length > 0 && (
          <ul className="space-y-1.5 text-sm">
            {missed.map((i) => (
              <li key={i}>
                <button type="button" className="w-full rounded-md bg-muted px-2.5 py-1.5 text-left hover:bg-muted/70" onClick={() => go(list.indexOf(i))}>
                  {sentences[i].en}
                  <span className="ml-1.5 text-xs text-muted-foreground">{RESULT_LABEL[results.get(i) ?? 'shown']}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          {missed.length > 0 && (
            <Button
              onClick={() => {
                p.onReset(missed);
                setRound((r) => r + 1);
                go(list.indexOf(missed[0]));
              }}
            >
              <RotateCcw />
              重练没一次填对的 {missed.length} 句
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => {
              p.onReset(list);
              setRound((r) => r + 1);
              go(0);
            }}
          >
            从头再来
          </Button>
        </div>
      </CardShell>
    );
  }

  return (
    <Cloze
      // 换句、换挖空多少、重练时从头开始
      key={`${current}:${p.level}:${round}`}
      frame={frame}
      sentence={sentences[current]}
      vocab={p.vocab}
      level={p.level}
      result={results.get(current)}
      playing={p.playing}
      onPlay={(slow) => p.onPlay(current, slow)}
      onStop={p.onStop}
      onDone={(r) => p.onResult(current, r)}
      onNext={() => (at + 1 < list.length ? go(at + 1) : setSummary(true))}
      last={at + 1 >= list.length}
      onAddWord={p.onAddWord}
      canAddWord={p.canAddWord}
    />
  );
};

/** 精听设置（⚙）：挖空多少 */
const LevelSettings: React.FC<{ level: BlankLevel; onLevel: (level: BlankLevel) => void }> = ({ level, onLevel }) => (
  <Popover>
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="练习设置">
            <Settings2 />
          </Button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent>练习设置</TooltipContent>
    </Tooltip>
    <PopoverContent align="start" className="w-64">
      <div className="flex items-center justify-between gap-3">
        <Label className="font-normal">挖空</Label>
        <ToggleGroup type="single" size="sm" variant="outline" value={level} onValueChange={(v) => v && onLevel(v as BlankLevel)}>
          <ToggleGroupItem value="few" className="px-2.5">
            少（关键词）
          </ToggleGroupItem>
          <ToggleGroupItem value="many" className="px-2.5">
            多
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </PopoverContent>
  </Popover>
);

interface ClozeProps {
  frame: Frame;
  sentence: PassageSentence;
  vocab: string[];
  level: BlankLevel;
  result?: DictationResult;
  playing: 'normal' | 'slow' | null;
  onPlay: (slow: boolean) => void;
  onStop: () => void;
  onDone: (result: DictationResult) => void;
  onNext: () => void;
  last: boolean;
  onAddWord?: (word: string) => void;
  canAddWord?: (word: string) => boolean;
}

/** 一句填空（换句时整个重建） */
const Cloze: React.FC<ClozeProps> = ({ frame, sentence, vocab, level, result, playing, onPlay, onStop, onDone, onNext, last, onAddWord, canAddWord }) => {
  const words = useMemo(() => sentenceWords(sentence.en), [sentence.en]);
  const blanks = useMemo(() => pickBlanks(sentence.en, vocab, level), [sentence.en, vocab, level]);
  const pieces = useMemo(() => markedPieces(sentence.en, locateWords(sentence.en, words), words.map((_, i) => blanks.indexOf(i))), [sentence.en, words, blanks]);
  const [typed, setTyped] = useState<string[]>(() => blanks.map(() => ''));
  /** 核对后每个空对不对；改了的空回到未核对 */
  const [marks, setMarks] = useState<(boolean | null)[]>(() => blanks.map(() => null));
  /** 每个空露出了几个字母（提示） */
  const [hints, setHints] = useState<number[]>(() => blanks.map(() => 0));
  /** 第一次核对（或第一次要提示）时没填对的词（做完后列出来，可以加入词汇） */
  const [missed, setMissed] = useState<string[] | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<DictationResult | null>(result ?? null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const finish = (r: DictationResult) => {
    setDone(r);
    onDone(r);
  };

  const check = () => {
    if (typed.every((t) => !t.trim())) return;
    const next = blanks.map((b, k) => blankCorrect(words[b], typed[k]));
    setMarks(next);
    if (!missed) setMissed(blanks.filter((_, k) => !next[k]).map((b) => words[b]));
    if (next.every(Boolean)) return finish(missed === null ? 'first' : 'fixed');
    inputs.current[next.findIndex((ok) => !ok)]?.focus();
  };

  /** 提示：还没填对的空各多露出一个字母 */
  const hint = () => {
    setHints((h) => h.map((n, k) => (marks[k] === true ? n : Math.min(words[blanks[k]].length - 1, n + 1))));
    if (!missed) setMissed(blanks.map((b) => words[b]).filter((_, k) => marks[k] !== true));
  };

  const wrong = done === 'shown' ? blanks.map((b) => words[b]) : (missed ?? []);
  const addable = done && onAddWord ? wrong.filter((w) => canAddWord?.(w) && !added.has(w.toLowerCase())) : [];

  const footer = (
    <>
      <NavButton label="上一句" onClick={frame.onPrev}>
        <ChevronLeft />
      </NavButton>
      <Tooltip>
        <TooltipTrigger asChild>
          <SpeakButton variant="ghost" size="icon" className="size-8" label="播放这一句" status={playing === 'normal' ? 'playing' : 'idle'} onClick={() => (playing === 'normal' ? onStop() : onPlay(false))} />
        </TooltipTrigger>
        <TooltipContent>{playing === 'normal' ? '停止' : '播放这一句'}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <SpeakButton variant="ghost" size="icon" className="size-8" label="慢速播放" slow status={playing === 'slow' ? 'playing' : 'idle'} onClick={() => (playing === 'slow' ? onStop() : onPlay(true))} />
        </TooltipTrigger>
        <TooltipContent>{playing === 'slow' ? '停止' : '慢速播放'}</TooltipContent>
      </Tooltip>
      <BarIcon label="提示：露出一个字母" onClick={hint} disabled={Boolean(done)}>
        <Lightbulb />
      </BarIcon>
      <BarIcon label="看答案" onClick={() => finish('shown')} disabled={Boolean(done)}>
        <Eye />
      </BarIcon>
      {frame.settings}
      <div className="ml-auto">
        {done ? (
          <Button size="sm" autoFocus onClick={onNext}>
            {last ? '看结果' : '下一句'}
          </Button>
        ) : (
          <Button size="sm" onClick={check} disabled={typed.every((t) => !t.trim())}>
            核对
          </Button>
        )}
      </div>
      <NavButton label="下一句" onClick={frame.onNext}>
        <ChevronRight />
      </NavButton>
    </>
  );

  return (
    <CardShell position={frame.position} strip={frame.strip} stripCurrent={frame.current} onPick={frame.onPick} footer={footer}>
      {done ? (
        <>
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="text-lg leading-relaxed">
              {pieces.map((piece, k) => (
                <span key={k} className={cn(piece.mark !== null && piece.mark >= 0 && 'font-medium text-primary')}>
                  {piece.text}
                </span>
              ))}
            </p>
            {sentence.zh && <p className="mt-1 text-sm text-muted-foreground">{sentence.zh}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('flex items-center gap-1 text-sm', done === 'shown' ? 'text-muted-foreground' : done === 'first' ? 'text-success' : 'text-warning')}>
              {done === 'shown' ? <Eye className="size-4" /> : <Check className="size-4" />}
              {RESULT_LABEL[done]}
            </span>
            {addable.map((w) => (
              <Button
                key={w}
                variant="outline"
                size="sm"
                className="h-7"
                onClick={() => {
                  onAddWord?.(w);
                  setAdded((s) => new Set(s).add(w.toLowerCase()));
                }}
              >
                <Plus />
                {w} 加入词汇
              </Button>
            ))}
          </div>
        </>
      ) : (
        <p className="text-lg leading-loose">
          {pieces.map((piece, k) => {
            if (piece.mark === null || piece.mark < 0) return <span key={k}>{piece.text}</span>;
            const b = piece.mark;
            const mark = marks[b];
            return (
              <input
                key={k}
                ref={(el) => {
                  inputs.current[b] = el;
                }}
                autoFocus={b === 0}
                value={typed[b]}
                placeholder={hints[b] > 0 ? piece.text.slice(0, hints[b]) : undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  setTyped((t) => t.map((x, j) => (j === b ? v : x)));
                  setMarks((m) => m.map((x, j) => (j === b ? null : x)));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) check();
                }}
                style={{ width: `${piece.text.length + 1.5}ch` }}
                className={cn(
                  'mx-0.5 border-0 border-b-2 border-muted-foreground/35 bg-transparent px-0.5 text-center font-medium outline-none placeholder:text-muted-foreground/50 focus:border-primary',
                  mark === true && 'border-success text-success',
                  mark === false && 'border-destructive text-destructive'
                )}
                aria-label={`第 ${b + 1} 个空`}
                autoComplete="off"
                spellCheck={false}
              />
            );
          })}
        </p>
      )}
    </CardShell>
  );
};
