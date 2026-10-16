import { useEffect, useMemo, useState } from 'react';
import { videoService } from '@/services/videoService';
import { refineSentenceTimes, timesFromSpans } from '@/utils/speechBoundaries';
import type { SentenceSpan, WordSpan } from '@/types/video';

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
 * 台词与声音的对齐按片段 + 句子时间缓存（后端也缓存；这里免得每次打开页签都问一次）。
 * 片段按新字幕更新后句子时间变了，键跟着变，重新对齐
 */
const spansCache = new Map<string, Promise<(SentenceSpan | null)[] | null>>();
const loadSpans = (passageId: number, key: string) => {
  let p = spansCache.get(key);
  if (!p) {
    p = videoService.alignClip(passageId).then((r) => (r.success ? r.data : null));
    spansCache.set(key, p);
    // 没对上（模型还没下载、出错）的不缓存：下载模型后再打开就能用上
    void p.then((spans) => spans === null && spansCache.delete(key));
  }
  return p;
};

/** 片段时间最多等这么久（对齐一两分钟的片段要几秒；超时照用当时的时间） */
const READY_TIMEOUT_MS = 15000;

/**
 * 等片段时间就绪（台词对齐、波形都有结果了）再播原声：没对齐完时用的字幕时间常常整句早停半秒，正好切掉最后一个词。
 * `isReady` 读最新的状态（ref）；`alive` 返回 false（被打断）时提前结束。返回时是否还 alive
 */
export async function waitForClipTimes(isReady: () => boolean, alive: () => boolean = () => true): Promise<boolean> {
  const until = Date.now() + READY_TIMEOUT_MS;
  while (!isReady() && alive() && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
  return alive();
}

/**
 * 场景片段每句的播放起止（视频页、原文朗读、听力练习共用同一套时间）：
 * 优先用台词与声音对齐的结果（`passageId`，本机发音模型；字幕时间常常整句早或晚一两秒，按字幕切会切在说话中间），
 * 没对上的句子用字幕时间按声音停顿校准（见 utils/speechBoundaries），波形也读不到时原样返回。
 * `clip` 是短片在原视频里的位置。`ready`：时间是否就绪（台词对齐、波形都有结果了，不论成败），没就绪时开始单句播放用 waitForClipTimes 等一等；
 * `words`：每句每个词说出来的起止（对齐结果，同步跟读逐词标出）。
 */
export function useClipTiming<S extends { startMs?: number | null; endMs?: number | null }>(clip: { videoId: number; startMs: number } | null | undefined, sentences: S[], passageId?: number | null): { sentences: S[]; ready: boolean; words: (WordSpan[] | null)[] } {
  const [peaks, setPeaks] = useState<{ id: number; peaks: number[] } | null>(null);
  const [spans, setSpans] = useState<{ id: number; spans: (SentenceSpan | null)[] | null } | null>(null);
  const videoId = clip?.videoId ?? null;
  useEffect(() => {
    if (videoId === null) return;
    let alive = true;
    void loadPeaks(videoId).then((p) => alive && setPeaks({ id: videoId, peaks: p }));
    return () => {
      alive = false;
    };
  }, [videoId]);
  const alignId = videoId !== null && passageId ? passageId : null;
  const cacheKey = `${alignId}:${sentences.map((s) => `${s.startMs ?? ''}-${s.endMs ?? ''}`).join(',')}`;
  useEffect(() => {
    if (alignId === null) return;
    let alive = true;
    void loadSpans(alignId, cacheKey).then((s) => alive && setSpans({ id: alignId, spans: s }));
    return () => {
      alive = false;
    };
  }, [alignId, cacheKey]);
  // 换了视频 / 片段，旧的结果不算
  const peakList = peaks && peaks.id === videoId ? peaks.peaks : null;
  const spanList = spans && spans.id === alignId ? spans.spans : null;
  const ready = videoId === null || (peakList !== null && (alignId === null || (spans !== null && spans.id === alignId)));
  const offset = clip?.startMs ?? 0;
  const timed = useMemo(() => {
    const p = peakList ?? [];
    if (videoId === null || (p.length === 0 && !spanList)) return sentences;
    const refined = p.length > 0 ? refineSentenceTimes(sentences, p, offset) : sentences.map((s) => ({ startMs: s.startMs ?? 0, endMs: s.endMs ?? s.startMs ?? 0 }));
    const times = spanList && spanList.length === sentences.length ? timesFromSpans(refined, spanList) : refined;
    return sentences.map((s, i) => ({ ...s, ...times[i] }));
  }, [sentences, peakList, offset, videoId, spanList]);
  /** 每句每个词说出来的起止（同步跟读逐词标出）；没对齐时为 null */
  const words = useMemo(() => sentences.map((_, i) => (spanList && spanList.length === sentences.length ? (spanList[i]?.words ?? null) : null)), [sentences, spanList]);
  return { sentences: timed, ready, words };
}
