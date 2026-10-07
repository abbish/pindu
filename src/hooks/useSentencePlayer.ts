import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioPlayer } from './useAudioPlayer';
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
        if (!single && i + 1 < texts.length) audio.prefetch(texts[i + 1], 'sentence', undefined, speech());
        const repeat = Math.max(1, optionsRef.current.repeat ?? 1);
        for (let r = 1; r <= repeat; r++) {
          setRound(r);
          let ok = false;
          try {
            ok = await audio.playSentence(texts[i], undefined, { signal, ...speech() });
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
    [audio, texts]
  );

  // 预取第一句；离开页面时停止
  useEffect(() => {
    if (texts[0]) audio.prefetch(texts[0], 'sentence', undefined, { speed: optionsRef.current.speed, withTimings: optionsRef.current.withTimings });
    return () => abortRef.current?.abort();
    // 只在换短文时预取
  }, [texts]);

  return {
    current,
    playing,
    round,
    pausing,
    loading: audio.state.isLoading,
    /** 当前音频的逐词时间与播放位置（毫秒） */
    words: audio.state.words,
    timeMs: audio.state.currentTime * 1000,
    /** 实时播放位置（毫秒；没在播放为 null） */
    timeNowMs: useCallback(() => {
      const t = audio.currentTimeNow();
      return t == null ? null : t * 1000;
    }, [audio]),
    play,
    stop,
    setCurrent,
  };
}
