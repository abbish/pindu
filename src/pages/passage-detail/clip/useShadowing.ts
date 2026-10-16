import { useCallback, useEffect, useRef, useState } from 'react';
import { useRecorder } from '@/hooks/useRecorder';
import { pronunciationService } from '@/services/pronunciationService';
import { pcmSliceUrl, pcmToBase64, recordingToPcm } from '@/utils/audioPcm';
import { trackPlayback } from '@/utils/playbackTail';
import type { ShadowWord } from '@/types/pronunciation';
import type { WordSpan } from '@/types/video';

/** 一句影子跟读的结果 */
export interface ShadowResult {
  /** 每个词说没说出来；评估模型没下载时为空（只有录音） */
  words: ShadowWord[];
  /** 比原声慢多少（毫秒）；一个词都没说出来、没评估时为 null */
  lagMs: number | null;
  /** 回放：这句自己的录音（从录音里切出来的一小段） */
  takeUrl: string;
}

type ShadowPhase = 'idle' | 'arming' | 'playing' | 'assessing';

/** 原声放完后再录这么久（学习者比原声慢） */
const TAIL_MS = 1500;
/** 一段最长录多久（与后端 MAX_SHADOW_SECONDS 一致） */
const MAX_MS = 6 * 60 * 1000;
/** 学习者会比原声慢：评估时每句在录音里的参考范围往后放这么多 */
const LAG_ROOM_MS = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ShadowingOptions {
  texts: string[];
  /** 换了一篇才清掉结果（选词加入词汇、改译文会换一份新的句子数组，结果不能因此清掉） */
  resetKey: number;
  /** 每句在短片里的起止（最新的，见 useClipTiming） */
  timesRef: React.RefObject<{ startMs?: number | null; endMs?: number | null }[]>;
  /** 每句每个词说出来的起止（算落后多少用） */
  wordsRef: React.RefObject<(WordSpan[] | null)[]>;
  /** 播放速度（原声在录音里的位置要按它换算） */
  rateRef: React.RefObject<number>;
  /** 连着放第 from 到第 to 句的原声；真正开始放时调用 onStart；放完返回 true，被打断返回 false */
  playRange: (from: number, to: number, onStart: () => void) => Promise<boolean>;
}

/**
 * 影子跟读：一段句子连着放原声、同时录下学习者跟着说的整段（要戴耳机，不然原声会被录进去），
 * 放完多录一会儿，交给本机评估（把台词对到录音上，逐句看每个词说没说出来、比原声慢多少）。
 * - `runUnit(indices, alive)` 练一段连续的句子；麦克风打不开返回 'mic'，被打断返回 'stopped'；
 * - `results` 每句的结果（可以回放自己的录音）；
 * - `stop()` 停下（录到的丢掉）。
 */
export function useShadowing({ texts, resetKey, timesRef, wordsRef, rateRef, playRange }: ShadowingOptions) {
  const recorder = useRecorder({ silenceStopMs: 0, maxMs: MAX_MS });
  const [phase, setPhase] = useState<ShadowPhase>('idle');
  const [results, setResults] = useState<Map<number, ShadowResult>>(new Map());
  /** 评估模型没下载：只留录音 */
  const [unscored, setUnscored] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replaying, setReplaying] = useState<number | null>(null);
  const stateRef = useRef(recorder.state);
  stateRef.current = recorder.state;
  const endedRef = useRef(recorder.ended);
  endedRef.current = recorder.ended;
  const takeRef = useRef(recorder.take);
  takeRef.current = recorder.take;
  /** 每句切出来的录音地址，卸载时释放 */
  const urls = useRef<string[]>([]);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(
    () => () => {
      audio.current?.pause();
      urls.current.forEach((u) => URL.revokeObjectURL(u));
    },
    []
  );

  /** 卸载后不再写结果、不再切录音（切了没人释放） */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => void (mounted.current = false);
  }, []);

  /** 释放这些结果的录音地址 */
  const release = (list: Iterable<ShadowResult>) => {
    for (const r of list) {
      URL.revokeObjectURL(r.takeUrl);
      urls.current = urls.current.filter((u) => u !== r.takeUrl);
    }
  };

  const resultsRef = useRef(results);
  resultsRef.current = results;

  // 换了一篇：清掉
  useEffect(() => {
    release(resultsRef.current.values());
    setResults(new Map());
  }, [resetKey]);

  const stopReplay = useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    setReplaying(null);
  }, []);

  const stop = useCallback(() => {
    recorder.stop();
    recorder.close();
    setPhase('idle');
  }, [recorder]);

  /** 等录音器的状态变成 cond（最多 ms） */
  const until = async (cond: () => boolean, ms: number) => {
    const end = performance.now() + ms;
    while (!cond() && performance.now() < end) await sleep(30);
    return cond();
  };

  const runUnit = useCallback(
    async (indices: number[], alive: () => boolean): Promise<'done' | 'mic' | 'stopped'> => {
      if (indices.length === 0) return 'done';
      stopReplay();
      setError(null);
      setPhase('arming');
      const before = endedRef.current;
      const started = await recorder.start('shadow');
      if (!started || !(await until(() => stateRef.current === 'recording' || endedRef.current !== before, 5000)) || stateRef.current !== 'recording') {
        setPhase('idle');
        if (alive()) setError(recorder.error ?? '没能开始录音');
        return alive() ? 'mic' : 'stopped';
      }
      if (!alive()) {
        stop();
        return 'stopped';
      }
      setPhase('playing');
      let playAt = 0;
      const first = indices[0];
      const last = indices[indices.length - 1];
      const played = await playRange(first, last, () => (playAt = performance.now()));
      if (!played || !alive() || playAt === 0) {
        stop();
        return 'stopped';
      }
      await sleep(TAIL_MS);
      if (!alive()) {
        stop();
        return 'stopped';
      }
      const endedBefore = endedRef.current;
      recorder.stop();
      await until(() => endedRef.current !== endedBefore, 5000);
      recorder.close();
      const take = takeRef.current;
      if (!take || take.tag !== 'shadow') {
        setPhase('idle');
        setError('没有录到声音');
        return 'mic';
      }
      setPhase('assessing');
      // 解码、评估出错都不能让界面卡在「正在评估」
      let pcm: Int16Array;
      let r: Awaited<ReturnType<typeof pronunciationService.assessShadowing>>;
      const rate = rateRef.current || 1;
      const times = timesRef.current;
      const unitStart = times[first]?.startMs ?? 0;
      /** 短片里的时刻 → 录音里的时刻 */
      const inTake = (ms: number) => playAt - take.startedAt + (ms - unitStart) / rate;
      const windows = indices.map((i) => {
        const s = times[i];
        return [Math.round(inTake(s?.startMs ?? 0)), Math.round(inTake(s?.endMs ?? 0) + LAG_ROOM_MS)] as [number, number];
      });
      try {
        pcm = await recordingToPcm(take.url);
        r = await pronunciationService.assessShadowing({ texts: indices.map((i) => texts[i]), windows, audio: pcmToBase64(pcm) });
      } catch {
        if (mounted.current && alive()) {
          setPhase('idle');
          setError('录音读不了，再跟一遍');
        }
        return alive() ? 'mic' : 'stopped';
      }
      // 评估期间离开了或重新开始了：旧结果不要了
      if (!mounted.current || !alive()) return 'stopped';
      const scored = r.success;
      setUnscored(!scored && r.code === 'NOT_FOUND');
      if (!scored && r.code !== 'NOT_FOUND') setError(r.error);
      // 录音地址在更新状态之外切好（状态更新函数可能被调两次）
      const fresh = indices.map((i, k): [number, ShadowResult] => {
        const s = times[i];
        const [wa, wb] = windows[k];
        const got = scored ? r.data[k] : null;
        // 落后多少：第一个说出来的词比原声里同一个词晚多少（按词的先后对应，句子里重复的词不会对错）
        const firstAt = got?.words.findIndex((w) => w.said && w.startMs !== null) ?? -1;
        const firstSaid = firstAt >= 0 ? got?.words[firstAt] : undefined;
        const origWords = wordsRef.current[i] ?? [];
        const before = got ? got.words.slice(0, firstAt).filter((w) => w.word === firstSaid?.word).length : 0;
        const orig = firstSaid && origWords.filter((w) => w.word === firstSaid.word)[before];
        const lagMs = firstSaid?.startMs != null ? Math.round(firstSaid.startMs - inTake(orig ? orig.startMs : (s?.startMs ?? 0))) : null;
        const takeUrl = pcmSliceUrl(pcm, Math.max(0, (got?.startMs ?? wa) - 150), (got?.endMs ?? wb - LAG_ROOM_MS) + 300);
        urls.current.push(takeUrl);
        return [i, { words: got?.words ?? [], lagMs, takeUrl }];
      });
      // 同一句重练：上一次的录音地址释放掉
      release(fresh.flatMap(([i]) => (resultsRef.current.get(i) ? [resultsRef.current.get(i) as ShadowResult] : [])));
      setResults((m) => {
        const next = new Map(m);
        fresh.forEach(([i, result]) => next.set(i, result));
        return next;
      });
      setPhase('idle');
      return 'done';
    },
    [recorder, playRange, texts, timesRef, wordsRef, rateRef, stop, stopReplay]
  );

  /** 回放这句自己的录音 */
  const replay = useCallback(
    (index: number) => {
      const r = results.get(index);
      if (!r) return;
      if (replaying === index) return stopReplay();
      stopReplay();
      const a = new Audio(r.takeUrl);
      trackPlayback(a);
      audio.current = a;
      setReplaying(index);
      a.addEventListener('ended', () => audio.current === a && stopReplay(), { once: true });
      void a.play();
    },
    [results, replaying, stopReplay]
  );

  return { phase, results, unscored, error, replaying, runUnit, replay, stopReplay, stop };
}
