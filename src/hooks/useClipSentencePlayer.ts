import { useCallback, useEffect, useRef, useState } from 'react';

/** 一句在短片里的起止（毫秒） */
export interface ClipSentence {
  startMs?: number;
  endMs?: number;
}

/**
 * 用视频切片的原声逐句播放（听力练习里代替合成语音）：接口与 `useSentencePlayer` 一致——
 * 连播（从某句开始，播到最后一句结束）/ 只播一句 / 停止；`slow` 时 0.75 倍速。
 */
export function useClipSentencePlayer(url: string | null, sentences: ClipSentence[], options: { slow?: boolean } = {}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  /** 只播一句时停在这里（毫秒）；连播时为最后一句的结尾 */
  const stopAt = useRef<number | null>(null);
  const single = useRef(false);

  useEffect(() => {
    if (!url) return;
    const audio = new Audio(url);
    audio.preload = 'auto';
    audioRef.current = audio;
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('play', onPlay);
    return () => {
      audio.pause();
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('play', onPlay);
      audioRef.current = null;
    };
  }, [url]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = options.slow ? 0.75 : 1;
  }, [options.slow, url]);

  // 播放中跟踪当前句，到终点停下
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const a = audioRef.current;
      if (a) {
        const t = a.currentTime * 1000;
        if (!single.current) {
          const i = sentences.findIndex((s) => (s.startMs ?? 0) <= t && t < (s.endMs ?? 0));
          if (i >= 0) setCurrent(i);
        }
        if (stopAt.current !== null && t >= stopAt.current) {
          a.pause();
          stopAt.current = null;
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, sentences]);

  const play = useCallback(
    (index: number, onlyThis = false) => {
      const a = audioRef.current;
      const s = sentences[index];
      if (!a || !s) return;
      single.current = onlyThis;
      setCurrent(index);
      a.currentTime = (s.startMs ?? 0) / 1000;
      stopAt.current = onlyThis ? (s.endMs ?? null) : (sentences[sentences.length - 1]?.endMs ?? null);
      void a.play();
    },
    [sentences]
  );

  const stop = useCallback(() => {
    stopAt.current = null;
    audioRef.current?.pause();
  }, []);

  return { current, playing, loading: false, play, stop };
}
