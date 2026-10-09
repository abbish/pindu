import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Eye, Headphones, RotateCcw, Snail, Trophy, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { buildTiles, checkBuild, type WordTile } from '@/utils/sentenceBuilder';
import type { PassageSentence } from '@/types/passage';

export interface ListenBuildPanelProps {
  sentences: PassageSentence[];
  /** 当前句（由父组件控制，视频跟着跳） */
  index: number;
  onIndexChange: (index: number) => void;
  /** 播放这一句原声；slow 用 0.75 倍速 */
  onPlay: (index: number, slow: boolean) => void;
  /** 这一句做完了（对或看了答案）：父组件据此在画面上显示这句字幕 */
  onSolved: (index: number) => void;
  /** 有阅读理解题时：去做听力题 */
  onPractice?: () => void;
}

type Result = 'first' | 'retry' | 'shown';

/**
 * 听句拼句：每句先只听（画面不显示字幕），再用打乱的单词卡（混入几个干扰词）按顺序拼出听到的句子。
 * 拼完核对，错的词标红可撤回重拼；可重听、慢速、看答案。全部做完给出结果，没一次拼对的句子可以再练一遍。
 */
export const ListenBuildPanel: React.FC<ListenBuildPanelProps> = ({ sentences, index, onIndexChange, onPlay, onSolved, onPractice }) => {
  const [results, setResults] = useState<(Result | null)[]>(() => sentences.map(() => null));
  const [picked, setPicked] = useState<WordTile[]>([]);
  const [checked, setChecked] = useState<boolean[] | null>(null);
  const [tries, setTries] = useState(0);
  /** 只练这些句（再练没拼对的）；null 为全部 */
  const [queue, setQueue] = useState<number[] | null>(null);
  const [finished, setFinished] = useState(false);

  const sentence = sentences[index];
  const others = useMemo(() => sentences.filter((_, i) => i !== index).map((s) => s.en), [sentences, index]);
  const tiles = useMemo(() => (sentence ? buildTiles(sentence.en, others) : []), [sentence, others]);
  const done = results[index] ?? null;
  const order = queue ?? sentences.map((_, i) => i);
  const position = order.indexOf(index);

  // 换句：清空，自动播一遍
  useEffect(() => {
    setPicked([]);
    setChecked(null);
    setTries(0);
    if (!finished) onPlay(index, false);
    // 只在换句时触发
  }, [index]);

  const settle = (result: Result) => {
    setResults((r) => r.map((x, i) => (i === index ? result : x)));
    onSolved(index);
  };

  const pick = (tile: WordTile) => {
    if (done) return;
    setChecked(null);
    setPicked((p) => [...p, tile]);
  };

  const check = () => {
    if (!sentence) return;
    const result = checkBuild(sentence.en, picked.map((t) => t.text));
    setChecked(result.marks);
    setTries((t) => t + 1);
    if (result.correct) settle(tries === 0 ? 'first' : 'retry');
  };

  const reveal = () => {
    settle('shown');
    setChecked(null);
  };

  const next = () => {
    const after = order[position + 1];
    if (after === undefined) setFinished(true);
    else onIndexChange(after);
  };

  if (finished) {
    const total = order.length;
    const first = order.filter((i) => results[i] === 'first').length;
    const missed = order.filter((i) => results[i] !== 'first');
    return (
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-2 font-medium">
          <Trophy className="size-5 text-warning" />
          听完了
        </div>
        <div className="text-sm">
          一次拼对 <span className="text-lg font-semibold tabular-nums">{first}</span> / {total} 句
        </div>
        <Progress value={(first / Math.max(1, total)) * 100} />
        {missed.length > 0 && (
          <ul className="max-h-60 space-y-1.5 overflow-y-auto text-sm">
            {missed.map((i) => (
              <li key={i} className="rounded-md bg-muted px-2 py-1.5">
                {sentences[i].en}
                <span className="ml-1 text-xs text-muted-foreground">{results[i] === 'shown' ? '看了答案' : '重拼后对'}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          {missed.length > 0 && (
            <Button
              onClick={() => {
                setResults((r) => r.map((x, i) => (missed.includes(i) ? null : x)));
                setQueue(missed);
                setFinished(false);
                onIndexChange(missed[0]);
              }}
            >
              <RotateCcw />
              再练没拼对的 {missed.length} 句
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => {
              setResults(sentences.map(() => null));
              setQueue(null);
              setFinished(false);
              onIndexChange(0);
            }}
          >
            从头再来
          </Button>
          {onPractice && (
            <Button variant="outline" onClick={onPractice}>
              做听力题
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!sentence) return null;
  const usedIds = new Set(picked.map((t) => t.id));
  const solvedCount = order.filter((i) => results[i]).length;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Headphones className="size-3.5" />
        听一句，拼出来
        <span className="ml-auto tabular-nums">
          {position + 1} / {order.length}
        </span>
      </div>
      <Progress value={(solvedCount / Math.max(1, order.length)) * 100} className="h-1" />

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => onPlay(index, false)}>
          <RotateCcw />
          再听
        </Button>
        <Button variant="outline" size="sm" onClick={() => onPlay(index, true)}>
          <Snail />
          慢速
        </Button>
        {!done && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={reveal}>
            <Eye />
            看答案
          </Button>
        )}
      </div>

      {/* 拼出的句子 */}
      <div className={cn('flex min-h-14 flex-wrap content-start gap-1.5 rounded-lg border border-dashed p-2', done && 'border-solid bg-muted/40')}>
        {done === 'shown' ? (
          <span className="text-[15px]">{sentence.en}</span>
        ) : picked.length === 0 ? (
          <span className="self-center px-1 text-sm text-muted-foreground">按听到的顺序点下面的词</span>
        ) : (
          picked.map((t, i) => (
            <button
              key={t.id}
              type="button"
              disabled={Boolean(done)}
              onClick={() => {
                setChecked(null);
                setPicked((p) => p.filter((x) => x.id !== t.id));
              }}
              className={cn(
                'rounded-md border bg-background px-2 py-1 text-[15px] shadow-xs transition-colors',
                checked && (checked[i] ? 'border-success/60 bg-success-soft' : 'border-destructive/60 bg-destructive/10 text-destructive'),
                done && 'border-success/60 bg-success-soft'
              )}
            >
              {t.text}
            </button>
          ))
        )}
      </div>
      {done && sentence.zh && <p className="-mt-2 text-sm text-muted-foreground">{sentence.zh}</p>}

      {/* 单词卡 */}
      {!done && (
        <div className="flex flex-wrap gap-1.5">
          {tiles.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => pick(t)}
              disabled={usedIds.has(t.id)}
              className="rounded-md border bg-card px-2 py-1 text-[15px] shadow-xs transition-[opacity,transform] hover:bg-muted active:scale-95 disabled:opacity-25"
            >
              {t.text}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        {done ? (
          <>
            <span className={cn('flex items-center gap-1 text-sm', done === 'shown' ? 'text-muted-foreground' : 'text-success')}>
              {done === 'shown' ? <Eye className="size-4" /> : <Check className="size-4" />}
              {done === 'first' ? '一次拼对' : done === 'retry' ? '拼对了' : '看了答案'}
            </span>
            <Button className="ml-auto" onClick={next}>
              {position + 1 < order.length ? '下一句' : '看结果'}
              <ChevronRight />
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={() => setPicked((p) => p.slice(0, -1))} disabled={picked.length === 0}>
              <Undo2 />
              撤回
            </Button>
            {checked && !checked.every(Boolean) && (
              <span className="flex items-center gap-1 text-sm text-destructive">
                <X className="size-4" />
                不对，点红色的词撤回再试
              </span>
            )}
            <Button className="ml-auto" onClick={check} disabled={picked.length === 0}>
              核对
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
