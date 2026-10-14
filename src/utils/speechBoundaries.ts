/**
 * 场景片段的句子边界按声音校准：字幕一条接一条时，上一条的结束常常就是下一句开口的时刻，甚至晚于它，
 * 单句播放停在这里会带出下一句的开头。做法：找跨过（或紧挨着）字幕交界的那段安静，
 * 上一句停在安静开始处、下一句从安静结束处开始（各留一点余量）。交界附近没有安静（说话连着）就保持字幕时间，
 * 句子中间的停顿离交界远，不会被当成句间停顿。
 */

/** 波形每秒的峰值个数（与后端 media::PEAKS_PER_SECOND 一致） */
export const PEAKS_PER_SECOND = 50;
const FRAME_MS = 1000 / PEAKS_PER_SECOND;
/** 低于它算安静：按这段的底噪定（底噪 × 1.6），夹在这两个值之间——小声的素材（如无线电通话，尾音只有 0.04）不把尾音当安静，有背景音乐的也不至于找不到停顿 */
const QUIET_MIN = 0.015;
const QUIET_MAX = 0.06;
/** 底噪：这一段音量从低到高第 20% 的值 */
const FLOOR_PERCENTILE = 0.2;
/** 安静至少这么长才算句间停顿 */
const MIN_GAP_MS = 60;
/** 句间停顿要碰到交界前后这个范围（字幕多半比说话晚，往前放宽一些） */
const NEAR_BEFORE_MS = 400;
const NEAR_AFTER_MS = 200;
/** 停顿里留给下一句的起音 */
const PAD_MS = 60;
/** 上一句停在停顿里多远：暂停时还没从扬声器放出来的一小段会被丢掉（蓝牙耳机更多），停在停顿开始处听起来就像没读完 */
const TAIL_MS = 250;
/** 每句至少留这么长，不会被校准吃掉 */
const MIN_SENTENCE_MS = 300;
/** 两句之间已经隔开这么多的，不用校准 */
const APART_MS = 300;

export interface Timed {
  startMs?: number | null;
  endMs?: number | null;
}

/**
 * 校准后的每句起止（相对短片开头）。
 * `peaks` 是整部视频的波形，`offsetMs` 是短片在原视频里的开头。
 */
export function refineSentenceTimes(sentences: Timed[], peaks: number[], offsetMs: number): { startMs: number; endMs: number }[] {
  const times = sentences.map((s) => {
    const startMs = s.startMs ?? 0;
    return { startMs, endMs: Math.max(startMs, s.endMs ?? startMs) };
  });
  if (peaks.length === 0 || times.length === 0) return times;
  const level = (ms: number) => peaks[Math.floor((ms + offsetMs) / FRAME_MS)] ?? 0;
  const QUIET = quietLevel(peaks.slice(Math.floor((times[0].startMs + offsetMs) / FRAME_MS), Math.ceil((times[times.length - 1].endMs + offsetMs) / FRAME_MS)));
  for (let i = 0; i + 1 < times.length; i++) {
    const prev = times[i];
    const next = times[i + 1];
    if (next.startMs - prev.endMs >= APART_MS) continue;
    const boundary = (prev.endMs + next.startMs) / 2;
    // 停顿可以从附近一直延伸出去：在每句允许的范围里找，只要求它碰到交界附近
    const from = prev.startMs + MIN_SENTENCE_MS;
    const to = next.endMs - MIN_SENTENCE_MS;
    if (to - from < MIN_GAP_MS) continue;
    const nearFrom = boundary - NEAR_BEFORE_MS;
    const nearTo = boundary + NEAR_AFTER_MS;
    // 碰到交界附近的安静里最长的一段
    let best: { start: number; end: number } | null = null;
    let runStart: number | null = null;
    for (let t = Math.max(from, nearFrom - 3000); t <= Math.min(to, nearTo + 3000) + FRAME_MS / 2; t += FRAME_MS) {
      const quiet = t <= to && level(t) < QUIET;
      if (quiet && runStart === null) runStart = t;
      if (!quiet && runStart !== null) {
        const run = { start: runStart, end: Math.min(t, to) };
        const touches = run.start <= nearTo && run.end >= nearFrom;
        if (touches && run.end - run.start >= MIN_GAP_MS && (!best || run.end - run.start > best.end - best.start)) best = run;
        runStart = null;
      }
    }
    if (!best) continue;
    const tail = Math.max(PAD_MS, Math.min(TAIL_MS, best.end - best.start - PAD_MS));
    prev.endMs = Math.round(Math.min(best.end, best.start + tail));
    next.startMs = Math.round(Math.max(prev.endMs, best.end - PAD_MS));
  }
  return times;
}

/** 这一段里算安静的音量（见 QUIET_MIN） */
export function quietLevel(levels: number[]): number {
  if (levels.length === 0) return QUIET_MAX;
  const sorted = [...levels].sort((a, b) => a - b);
  const floor = sorted[Math.floor((sorted.length - 1) * FLOOR_PERCENTILE)];
  return Math.min(QUIET_MAX, Math.max(QUIET_MIN, floor * 1.6));
}

/** 对齐出来的说话起止往外留的余量：句首提前一点（起音），句尾多留一点（尾音，暂停会丢掉还没放出来的一小段） */
const SPAN_LEAD_MS = 120;
const SPAN_TAIL_MS = 250;

/**
 * 用台词与声音对齐的结果（每句真正说出来的起止，见后端 clip_alignment）定单句播放的起止：
 * 前后各留余量，但不越过和相邻一句之间停顿的一半；没对上的句子用 `fallback`（字幕时间按声音校准）。
 */
export function timesFromSpans(fallback: { startMs: number; endMs: number }[], spans: ({ startMs: number; endMs: number } | null)[]): { startMs: number; endMs: number }[] {
  return fallback.map((f, i) => {
    const span = spans[i];
    if (!span) return f;
    const prev = spans[i - 1];
    const next = spans[i + 1];
    const lead = prev ? Math.min(SPAN_LEAD_MS, Math.max(0, span.startMs - prev.endMs) / 2) : SPAN_LEAD_MS;
    const tail = next ? Math.min(SPAN_TAIL_MS, Math.max(0, next.startMs - span.endMs) / 2) : SPAN_TAIL_MS;
    return { startMs: Math.max(0, Math.round(span.startMs - lead)), endMs: Math.round(span.endMs + tail) };
  });
}
