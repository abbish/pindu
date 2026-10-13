import React, { useEffect, useState } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRecorder } from '@/hooks/useRecorder';
import { usePronunciation } from '@/hooks/usePronunciation';
import type { Assessment, PronunciationContext } from '@/types/pronunciation';
import { SayText, SayVerdict } from './SayText';

/**
 * 原文每句后面的「跟读」（在句子分析图标左边）：点一下跟读这一句，读完本机评估，结果留在这句下面（逐词标色 + 三档 + 怎么读）。
 * 同一时间只录一句；录音中再点（这句或别的句子）是停止。设置里关掉跟读评估时不显示。
 * `onStart`：开始录音前调用（停掉正在放的原音 / 朗读，免得录进去）。
 * 返回 `action(i)`（放进句子行的按钮）与 `below(i)`（句子下面的状态 / 结果）。
 */
export function useSentenceSay(texts: string[], context?: PronunciationContext, onStart?: () => void) {
  const recorder = useRecorder({ silenceStopMs: 900, maxMs: 15000 });
  const say = usePronunciation(context);
  const [saying, setSaying] = useState<number | null>(null);
  const [results, setResults] = useState<Map<number, Assessment>>(new Map());

  // 换了一篇：清掉
  useEffect(() => {
    recorder.stop();
    setSaying(null);
    setResults(new Map());
  }, [texts]);

  // 一次录音结束：录到了就评估这句；没录到（太短、麦克风打不开）就算了。之后关掉麦克风
  useEffect(() => {
    if (saying === null) return;
    const index = saying;
    const take = recorder.take;
    recorder.close();
    if (!take || take.tag !== String(index)) {
      setSaying(null);
      return;
    }
    void say.assess(take.url, texts[index]).then((r) => {
      if (r) setResults((m) => new Map(m).set(index, r));
      setSaying((s) => (s === index ? null : s));
    });
  }, [recorder.ended]);

  const recording = recorder.state !== 'idle';
  const toggle = (i: number) => {
    if (say.ready === false) {
      if (!say.downloading) void say.download();
      return;
    }
    // 录音中点任何一句都是先停下（再点一次才开始那一句），不会一下停一下开
    if (recording) return recorder.stop();
    onStart?.();
    say.reset();
    setSaying(i);
    void recorder.start(String(i));
  };

  const action = (i: number): React.ReactNode => {
    if (!say.enabled) return null;
    const active = saying === i;
    const busy = active && (say.assessing || recorder.state === 'arming');
    const label = say.ready === false ? (say.downloading ? '正在下载评估模型' : '跟读（先下载评估模型）') : active && recording ? '停止' : '跟读';
    return (
      <button
        type="button"
        onClick={() => toggle(i)}
        disabled={busy || Boolean(say.downloading)}
        aria-label={`${label}：第 ${i + 1} 句`}
        title={label}
        className={cn(
          'mt-1.5 shrink-0 rounded-sm text-muted-foreground opacity-0 outline-none transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50',
          (active || results.has(i)) && 'opacity-100',
          active && recording && 'text-destructive hover:text-destructive'
        )}
      >
        {busy || (say.downloading && say.ready === false) ? <Loader2 className="size-4 animate-spin" /> : active && recording ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}
      </button>
    );
  };

  const below = (i: number): React.ReactNode => {
    const active = saying === i;
    const result = results.get(i);
    if (!active && !result) return null;
    return (
      <div className="mt-2 flex flex-col gap-1.5 rounded-lg border bg-background px-3 py-2 text-sm select-none" aria-live="polite">
        {active && recording ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Mic className="size-4 text-destructive" />
            {recorder.heard ? '在听…' : '请跟读'}
            <span className="flex h-4 items-end gap-0.5" aria-hidden>
              {recorder.live.slice(-12).map((v, k) => (
                <span key={k} className="w-0.5 rounded-full bg-primary" style={{ height: `${Math.max(2, v * 16)}px` }} />
              ))}
            </span>
          </div>
        ) : active && say.assessing ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在评分…
          </div>
        ) : result ? (
          <>
            <SayText text={texts[i]} result={result} strictness={say.strictness} />
            <SayVerdict result={result} strictness={say.strictness} showScore={say.showScore} />
          </>
        ) : (
          say.error && <div className="text-muted-foreground">{say.error}</div>
        )}
      </div>
    );
  };

  return { action, below };
}
