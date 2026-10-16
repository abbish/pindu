import { useCallback, useEffect, useRef, useState } from 'react';
import { waitForClipTimes } from '@/hooks/useClipTimes';
import { useAudioPlayer } from './useAudioPlayer';
import { seekMedia } from '@/utils/mediaSeek';
import { trackPlayback } from '@/utils/playbackTail';
import type { SpeechSpeed } from '../services/ttsService';

export interface SentencePlayerOptions {
  /** 语速：slow 再慢一档 */
  speed?: SpeechSpeed;
  /** 每句读几遍 */
  repeat?: number;
  /** 句与句之间停顿多久（毫秒），留出跟读时间 */
  pauseMs?: number;
  /** 取逐词时间（逐词高亮） */
  withTimings?: boolean;
  /**
   * 一句读完、进入下一句之前调用（如听后回忆）；返回的 Promise 结束后才继续。
   * 只在连续播放时调用，单句播放不调用。
   */
  afterSentence?: (index: number) => Promise<void> | void;
  /** 连续播放读完最后一句时调用（如盲听结束后显示原文） */
  onFinish?: () => void;
  /**
   * 用原声代替合成语音（场景片段）：短片地址 + 每句在短片里的起止（毫秒，按声音校准过的）。
   * 有逐词时间（台词对齐）时也逐词高亮；慢速是 0.75 倍速播放，不用联网、马上能播。
   */
  clip?: ClipSource | null;
}

export interface ClipSource {
  url: string;
  sentences: { startMs?: number | null; endMs?: number | null }[];
  /** 句子时间是否就绪（useClipTiming）；false 时播放前先等，不然按字幕时间会切掉句尾 */
  ready?: boolean;
  /** 每句每个词在短片里的起止（毫秒，台词对齐的结果）：逐词高亮用 */
  words?: ({ word: string; startMs: number; endMs: number }[] | null)[];
}

/** 原声慢速的播放倍速 */
const CLIP_SLOW_RATE = 0.75;
/** 原声提前一点停：暂停生效要一小会儿，不提前会漏出下一句的开头 */
const CLIP_STOP_LEAD_MS = 40;

/** 用一个音频元素播短片里的一段（到终点或被中止时停）；播完返回 true */
function playClipRange(audio: HTMLAudioElement, startMs: number, endMs: number, rate: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    let frame = 0;
    let settled = false;
    const end = Math.max(startMs, endMs - CLIP_STOP_LEAD_MS) / 1000;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      cancelAnimationFrame(frame);
      signal.removeEventListener('abort', onAbort);
      audio.removeEventListener('ended', onEnded);
      audio.pause();
      resolve(ok);
    };
    const onAbort = () => finish(false);
    const onEnded = () => finish(true);
    signal.addEventListener('abort', onAbort, { once: true });
    audio.addEventListener('ended', onEnded);
    const tick = () => {
      if (audio.currentTime >= end) return finish(true);
      frame = requestAnimationFrame(tick);
    };
    audio.playbackRate = rate;
    void seekMedia(audio, startMs / 1000)
      .then(() => (settled ? undefined : audio.play()))
      .then(() => {
        if (!settled) frame = requestAnimationFrame(tick);
      })
      .catch(() => finish(false));
  });
}

/** 可被中止的等待 */
function wait(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 逐句朗读一段短文：连播（从某句开始）/ 只播一句 / 停止；支持语速、每句重复、句间停顿、读完一句后的回调（听后回忆）。
 * 每句单独合成并缓存（style = sentence），播放下一句前预取；`words` / `timeMs` 用于逐词高亮。
 * 给了 `clip` 时改用原声：每句播短片里对应的那一段，其余（重复、停顿、回调）不变。
 */
export function useSentencePlayer(texts: string[], options: SentencePlayerOptions = {}) {
  const audio = useAudioPlayer();
  const [current, setCurrent] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  /** 当前句是第几遍（从 1 开始） */
  const [round, setRound] = useState(1);
  /** 句间停顿中 */
  const [pausing, setPausing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // 原声：一个音频元素，换短片时换
  const clipUrl = options.clip?.url ?? null;
  const clipAudio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!clipUrl) return;
    const a = new Audio(clipUrl);
    a.preload = 'auto';
    trackPlayback(a);
    clipAudio.current = a;
    return () => {
      a.pause();
      if (clipAudio.current === a) clipAudio.current = null;
    };
  }, [clipUrl]);
  /** 播第 i 句：原声或合成语音；播完返回 true */
  const playOne = useCallback(
    (text: string, i: number, signal: AbortSignal) => {
      const clip = optionsRef.current.clip;
      const a = clipAudio.current;
      if (clip && a) {
        return (async () => {
          if (clip.ready === false && !(await waitForClipTimes(() => optionsRef.current.clip?.ready !== false, () => !signal.aborted))) return false;
          // 等的时候换成了 AI 朗读：这一句不再用原声
          if (!optionsRef.current.clip) return false;
          const s = optionsRef.current.clip.sentences[i];
          if (!s) return false;
          const rate = optionsRef.current.speed === 'slow' ? CLIP_SLOW_RATE : 1;
          return playClipRange(a, s.startMs ?? 0, s.endMs ?? s.startMs ?? 0, rate, signal);
        })();
      }
      return audio.playSentence(text, undefined, { signal, speed: optionsRef.current.speed, withTimings: optionsRef.current.withTimings });
    },
    [audio]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    audio.stop();
    setPlaying(false);
    setPausing(false);
  }, [audio]);

  /** 从第 `from` 句开始播放；`single` 只播这一句（也按“每句读几遍”重复） */
  const play = useCallback(
    async (from: number, single = false) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      const { signal } = controller;
      abortRef.current = controller;
      setPlaying(true);
      const speech = () => ({ speed: optionsRef.current.speed, withTimings: optionsRef.current.withTimings });
      let finished = true;
      for (let i = from; i < texts.length; i++) {
        setCurrent(i);
        if (!single && i + 1 < texts.length && !optionsRef.current.clip) audio.prefetch(texts[i + 1], 'sentence', undefined, speech());
        const repeat = Math.max(1, optionsRef.current.repeat ?? 1);
        for (let r = 1; r <= repeat; r++) {
          setRound(r);
          let ok: boolean;
          try {
            ok = await playOne(texts[i], i, signal);
          } catch {
            ok = false;
          }
          if (!ok || signal.aborted) {
            finished = false;
            break;
          }
          if (r < repeat && !(await wait(600, signal))) {
            finished = false;
            break;
          }
        }
        if (!finished || single) break;
        await optionsRef.current.afterSentence?.(i);
        if (signal.aborted) {
          finished = false;
          break;
        }
        const pauseMs = optionsRef.current.pauseMs ?? 0;
        if (pauseMs > 0 && i + 1 < texts.length) {
          setPausing(true);
          const ok = await wait(pauseMs, signal);
          setPausing(false);
          if (!ok) {
            finished = false;
            break;
          }
        }
      }
      if (abortRef.current === controller) {
        abortRef.current = null;
        setPlaying(false);
        setRound(1);
        if (finished && !single) optionsRef.current.onFinish?.();
      }
    },
    [audio, texts, playOne]
  );

  // 预取第一句；离开页面时停止
  useEffect(() => {
    if (texts[0] && !optionsRef.current.clip) audio.prefetch(texts[0], 'sentence', undefined, { speed: optionsRef.current.speed, withTimings: optionsRef.current.withTimings });
    return () => abortRef.current?.abort();
    // 只在换短文时预取
  }, [texts]);

  return {
    current,
    playing,
    round,
    pausing,
    loading: clipUrl ? false : audio.state.isLoading,
    /** 当前音频的逐词时间与播放位置（毫秒）；原声用台词对齐的逐词时间（相对短片开头，和下面的播放位置一致） */
    words: clipUrl ? (current === null ? null : (options.clip?.words?.[current] ?? null)) : audio.state.words,
    timeMs: audio.state.currentTime * 1000,
    /** 实时播放位置（毫秒；没在播放为 null） */
    timeNowMs: useCallback(() => {
      if (optionsRef.current.clip) {
        const a = clipAudio.current;
        return a && !a.paused ? a.currentTime * 1000 : null;
      }
      const t = audio.currentTimeNow();
      return t == null ? null : t * 1000;
    }, [audio]),
    play,
    stop,
    setCurrent,
  };
}
