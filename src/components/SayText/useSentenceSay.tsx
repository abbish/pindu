import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PLAYBACK_TAIL_MS, useRecorder } from '@/hooks/useRecorder';
import { usePronunciation } from '@/hooks/usePronunciation';
import { MicProblem } from '@/components/MicProblem';
import type { Assessment, PronunciationContext } from '@/types/pronunciation';
import { SayText, SayVerdict } from './SayText';

/** 跟读一句的结局：评了分 / 只录下了（评估没开或模型没下载）/ 没录到 / 麦克风打不开 */
export type SayOutcome = 'scored' | 'recorded' | 'nothing' | 'mic';

/**
 * 句子跟读（原文每句后面的「跟读」、场景片段的跟读模式共用）：读完本机评估，结果留在这句下面（逐词标色 + 三档 + 怎么读），
 * 刚录的那句可以「听我的录音」和原声对比。
 * - `action(i)`：句子行里的跟读按钮（点一下跟读这一句；录音中再点任何一句都是停止）；评估关掉时不显示；
 * - `below(i)`：句子下面的状态 / 结果；
 * - `run(i)`：自动流程用（场景片段跟读：播完原声接着跟读），开麦录这一句，录完（评估开着时评完）才返回结局；
 *   评估没开或模型没下载时只录音，能回放；
 * - `stop()`：朗读、播放前停掉跟读（也关掉麦克风）；`release()`：自动流程走完时关掉一直开着的麦克风；`clear()`：清掉各句的结果（从头再来一遍）。
 * `onStart`：开始录音前调用（停掉正在放的原音 / 朗读，免得录进去）。
 */
export function useSentenceSay(texts: string[], context?: PronunciationContext, onStart?: () => void) {
  const recorder = useRecorder({ silenceStopMs: 900, maxMs: 15000 });
  const say = usePronunciation(context);
  const [saying, setSaying] = useState<number | null>(null);
  const [results, setResults] = useState<Map<number, Assessment>>(new Map());
  /** 只录下没评分的句子（评估没开或模型没下载） */
  const [recorded, setRecorded] = useState<Set<number>>(new Set());
  /** 麦克风打不开的那一句：在它下面说明原因 */
  const [micFailed, setMicFailed] = useState<number | null>(null);
  /** run() 在等的那一句 */
  const waiting = useRef<{ index: number; resolve: (o: SayOutcome) => void } | null>(null);
  /**
   * 自动流程中一句录完不关麦克风，到 release() / stop() 才关：每句开关一次时，蓝牙耳机会在通话与听音乐两种模式间来回切，
   * 切回来那一两秒正在播的原声会断掉、卡住；系统也可能重新配置声音输出。会议软件也是整个过程一直开着
   */
  const hold = useRef(false);
  const mine = useRef<HTMLAudioElement | null>(null);
  const [playingMine, setPlayingMine] = useState(false);
  const scoring = say.enabled && say.ready === true;

  const settle = (index: number, outcome: SayOutcome) => {
    const w = waiting.current;
    if (w && w.index === index) {
      waiting.current = null;
      w.resolve(outcome);
    }
  };

  const stopMine = () => {
    mine.current?.pause();
    mine.current = null;
    setPlayingMine(false);
  };

  // 换了一篇：清掉
  useEffect(() => {
    recorder.stop();
    stopMine();
    setSaying(null);
    setResults(new Map());
    setRecorded(new Set());
  }, [texts]);

  /** run() 开麦前的等待 */
  const beginTimer = useRef<number | undefined>(undefined);
  // 卸载时还在等的流程照常收尾
  useEffect(
    () => () => {
      window.clearTimeout(beginTimer.current);
      waiting.current?.resolve('nothing');
    },
    []
  );

  // 一次录音结束：录到了就评估这句（评估没开就只留下录音）；没录到（太短、麦克风打不开）就算了。之后关掉麦克风
  useEffect(() => {
    if (saying === null) return;
    const index = saying;
    const take = recorder.take;
    if (!hold.current) recorder.close();
    if (!take || take.tag !== String(index)) {
      const mic = Boolean(recorder.error);
      if (mic) setMicFailed(index);
      setSaying(null);
      settle(index, mic ? 'mic' : 'nothing');
      return;
    }
    if (!scoring) {
      setRecorded((s) => new Set(s).add(index));
      setSaying(null);
      settle(index, 'recorded');
      return;
    }
    void say.assess(take.url, texts[index]).then((r) => {
      if (r) setResults((m) => new Map(m).set(index, r));
      setSaying((s) => (s === index ? null : s));
      settle(index, r ? 'scored' : 'nothing');
    });
  }, [recorder.ended]);

  const recording = recorder.state !== 'idle';

  const begin = (i: number) => {
    onStart?.();
    stopMine();
    setMicFailed(null);
    say.reset();
    // 清掉上一次的录音：这次太短没录成时，结束时不会拿到上一次的
    recorder.clear();
    setSaying(i);
    void recorder.start(String(i));
  };

  const toggle = (i: number) => {
    if (say.ready === false) {
      if (!say.downloading) void say.download();
      return;
    }
    // 录音中点任何一句都是先停下（再点一次才开始那一句），不会一下停一下开
    if (recording) return recorder.stop();
    begin(i);
  };

  /** 自动流程：跟读第 i 句，录完（评完）返回结局；先等刚停的原声放完最后一点再开麦 */
  const run = (i: number) =>
    new Promise<SayOutcome>((resolve) => {
      waiting.current?.resolve('nothing');
      const w = { index: i, resolve };
      waiting.current = w;
      hold.current = true;
      onStart?.();
      window.clearTimeout(beginTimer.current);
      beginTimer.current = window.setTimeout(() => {
        if (waiting.current === w) begin(i);
      }, PLAYBACK_TAIL_MS);
    });

  const playMine = () => {
    if (playingMine) return stopMine();
    const take = recorder.take;
    if (!take) return;
    onStart?.();
    const audio = new Audio(take.url);
    mine.current = audio;
    const done = () => {
      if (mine.current === audio) stopMine();
    };
    audio.onended = done;
    audio.onerror = done;
    setPlayingMine(true);
    void audio.play().catch(done);
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
    if (micFailed === i && recorder.error) return <MicProblem message={recorder.error} problem={recorder.problem} className="mt-2" />;
    if (!active && !result && !recorded.has(i)) return null;
    // 刚录的就是这句：可以听自己的录音
    const mineButton =
      !active && recorder.take?.tag === String(i) ? (
        <Button variant="ghost" size="icon" className="ml-auto size-7" onClick={playMine} aria-label={playingMine ? '停止' : '听我的录音'} title={playingMine ? '停止' : '听我的录音'}>
          {playingMine ? <Square className="size-3.5 fill-current" /> : <Play className="size-3.5" />}
        </Button>
      ) : null;
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
            <Button variant="ghost" size="icon" className="ml-auto size-7" onClick={recorder.stop} aria-label="停止" title="停止">
              <Square className="size-3.5 fill-current" />
            </Button>
          </div>
        ) : active && say.assessing ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在评分…
          </div>
        ) : result ? (
          <>
            <div className="flex items-start gap-2">
              <SayText text={texts[i]} result={result} strictness={say.strictness} className="min-w-0 flex-1" />
              {mineButton}
            </div>
            <SayVerdict result={result} strictness={say.strictness} showScore={say.showScore} />
          </>
        ) : recorded.has(i) ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            已录好
            {mineButton}
          </div>
        ) : (
          say.error && <div className="text-muted-foreground">{say.error}</div>
        )}
      </div>
    );
  };

  /** 朗读、播放视频前调用：正在跟读就停下（不然会把朗读录进去），也停掉「听我的录音」 */
  /** 自动流程结束：关掉一直开着的麦克风 */
  const release = () => {
    hold.current = false;
    if (!recording) recorder.close();
  };

  const stop = () => {
    hold.current = false;
    if (recording) recorder.stop();
    else recorder.close();
    if (!recording && waiting.current && saying === null) {
      // 还在等开麦：不录了
      window.clearTimeout(beginTimer.current);
      const w = waiting.current;
      waiting.current = null;
      w.resolve('nothing');
    }
    stopMine();
  };

  /** 清掉各句的结果（从头再来一遍） */
  const clear = () => {
    setResults(new Map());
    setRecorded(new Set());
  };

  return { action, below, run, release, stop, clear, say, recording };
}
