import { useEffect, useMemo, useState } from 'react';
import { videoService } from '@/services/videoService';
import { refineSentenceTimes } from '@/utils/speechBoundaries';

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

/**
 * 场景片段的句子按声音校准起止（见 utils/speechBoundaries）：视频页、原文朗读、听力练习共用同一套时间。
 * `clip` 是短片在原视频里的位置；没有短片或波形还没读到时原样返回。
 */
export function useClipTimes<S extends { startMs?: number | null; endMs?: number | null }>(clip: { videoId: number; startMs: number } | null | undefined, sentences: S[]): S[] {
  const [peaks, setPeaks] = useState<number[]>([]);
  const videoId = clip?.videoId ?? null;
  useEffect(() => {
    if (videoId === null) return;
    let alive = true;
    void loadPeaks(videoId).then((p) => alive && setPeaks(p));
    return () => {
      alive = false;
    };
  }, [videoId]);
  const offset = clip?.startMs ?? 0;
  return useMemo(() => {
    if (videoId === null || peaks.length === 0) return sentences;
    const times = refineSentenceTimes(sentences, peaks, offset);
    return sentences.map((s, i) => ({ ...s, ...times[i] }));
  }, [sentences, peaks, offset, videoId]);
}
