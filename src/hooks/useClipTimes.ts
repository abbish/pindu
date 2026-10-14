import { useEffect, useMemo, useState } from 'react';
import { videoService } from '@/services/videoService';
import { refineSentenceTimes, timesFromSpans } from '@/utils/speechBoundaries';
import type { SentenceSpan } from '@/types/video';

/** 波形按视频缓存：同一个视频在几个页签 / 页面之间不重复读 */
const peaksCache = new Map<number, Promise<number[]>>();
const loadPeaks = (videoId: number) => {
  let p = peaksCache.get(videoId);
  if (!p) {
    p = videoService.getPeaks(videoId).then((r) => (r.success ? r.data : []));
    peaksCache.set(videoId, p);
    // 读不到的不缓存，下次再试
    void p.then((peaks) => peaks.length === 0 && peaksCache.delete(videoId));
  }
  return p;
};

/** 台词与声音的对齐按片段缓存（后端也缓存；这里免得每次打开页签都问一次） */
const spansCache = new Map<number, Promise<(SentenceSpan | null)[] | null>>();
const loadSpans = (passageId: number) => {
  let p = spansCache.get(passageId);
  if (!p) {
    p = videoService.alignClip(passageId).then((r) => (r.success ? r.data : null));
    spansCache.set(passageId, p);
    // 没对上（模型还没下载、出错）的不缓存：下载模型后再打开就能用上
    void p.then((spans) => spans === null && spansCache.delete(passageId));
  }
  return p;
};

/**
 * 场景片段每句的播放起止（视频页、原文朗读、听力练习共用同一套时间）：
 * 优先用台词与声音对齐的结果（`passageId`，本机发音模型；字幕时间常常整句早或晚一两秒，按字幕切会切在说话中间），
 * 没对上的句子用字幕时间按声音停顿校准（见 utils/speechBoundaries），波形也读不到时原样返回。
 * `clip` 是短片在原视频里的位置。
 */
export function useClipTimes<S extends { startMs?: number | null; endMs?: number | null }>(clip: { videoId: number; startMs: number } | null | undefined, sentences: S[], passageId?: number | null): S[] {
  const [peaks, setPeaks] = useState<number[]>([]);
  const [spans, setSpans] = useState<(SentenceSpan | null)[] | null>(null);
  const videoId = clip?.videoId ?? null;
  useEffect(() => {
    if (videoId === null) return;
    let alive = true;
    void loadPeaks(videoId).then((p) => alive && setPeaks(p));
    return () => {
      alive = false;
    };
  }, [videoId]);
  const alignId = videoId !== null && passageId ? passageId : null;
  useEffect(() => {
    setSpans(null);
    if (alignId === null) return;
    let alive = true;
    void loadSpans(alignId).then((s) => alive && setSpans(s));
    return () => {
      alive = false;
    };
  }, [alignId]);
  const offset = clip?.startMs ?? 0;
  return useMemo(() => {
    if (videoId === null) return sentences;
    const refined = peaks.length > 0 ? refineSentenceTimes(sentences, peaks, offset) : sentences.map((s) => ({ startMs: s.startMs ?? 0, endMs: s.endMs ?? s.startMs ?? 0 }));
    const times = spans && spans.length === sentences.length ? timesFromSpans(refined, spans) : refined;
    if (peaks.length === 0 && !spans) return sentences;
    return sentences.map((s, i) => ({ ...s, ...times[i] }));
  }, [sentences, peaks, offset, videoId, spans]);
}
