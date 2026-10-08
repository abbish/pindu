/**
 * 剪辑编辑器的切分规划操作（纯函数，有 node 测试）：吸附、拆分、合并、删除、拖动边界、新建片段、按字幕自动切分、检查。
 * 片段按开始时间排序、互不重叠；片段之间可以有空隙（不要的部分）。时间单位都是毫秒。
 */
import type { Cue, VideoPlan, VideoSegment } from '../../types/video';

/** 片段最短 */
export const MIN_SEGMENT_MS = 1000;
/** 片段太短 / 太长的提示阈值 */
export const SHORT_SEGMENT_MS = 10_000;
export const LONG_SEGMENT_MS = 5 * 60_000;
/** 吸附距离（按屏幕像素换算后的毫秒由调用方给） */
export const DEFAULT_SNAP_MS = 400;

let counter = 0;
export function newSegmentId(): string {
  counter += 1;
  return `s${Date.now().toString(36)}${counter.toString(36)}`;
}

export function emptySegment(startMs: number, endMs: number): VideoSegment {
  return { id: newSegmentId(), startMs, endMs, title: '', scene: '', level: '', focus: '', keyWords: [] };
}

export function sortSegments(segments: VideoSegment[]): VideoSegment[] {
  return [...segments].sort((a, b) => a.startMs - b.startMs);
}

/** 字幕边界（开始与结束时刻），升序去重 */
export function cueBoundaries(cues: Cue[]): number[] {
  return [...new Set(cues.flatMap((c) => [c.startMs, c.endMs]))].sort((a, b) => a - b);
}

/** 吸附到最近的字幕边界（距离在 `withinMs` 以内），否则原样返回 */
export function snapTime(t: number, boundaries: number[], withinMs = DEFAULT_SNAP_MS): number {
  let best = t;
  let bestDist = withinMs + 1;
  for (const b of boundaries) {
    const d = Math.abs(b - t);
    if (d < bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return bestDist <= withinMs ? best : t;
}

/** 在 t 处把包含它的片段拆成两段（离两端太近时不拆）；返回新规划与右半段 id */
export function splitAt(plan: VideoPlan, t: number): { plan: VideoPlan; rightId: string | null } {
  const seg = plan.segments.find((s) => s.startMs + MIN_SEGMENT_MS <= t && t <= s.endMs - MIN_SEGMENT_MS);
  if (!seg) return { plan, rightId: null };
  const right: VideoSegment = { ...seg, id: newSegmentId(), startMs: t, title: seg.title ? `${seg.title}（下）` : '' };
  const left: VideoSegment = { ...seg, endMs: t, title: seg.title ? `${seg.title}（上）` : '' };
  return {
    plan: { ...plan, segments: sortSegments(plan.segments.flatMap((s) => (s.id === seg.id ? [left, right] : [s]))) },
    rightId: right.id,
  };
}

export function removeSegment(plan: VideoPlan, id: string): VideoPlan {
  return { ...plan, segments: plan.segments.filter((s) => s.id !== id) };
}

/** 和后一段合并（中间的空隙并进来）；标题、重点词保留前一段的，重点词合并去重 */
export function mergeWithNext(plan: VideoPlan, id: string): VideoPlan {
  const segments = sortSegments(plan.segments);
  const i = segments.findIndex((s) => s.id === id);
  if (i === -1 || i === segments.length - 1) return plan;
  const [a, b] = [segments[i], segments[i + 1]];
  const merged: VideoSegment = {
    ...a,
    endMs: b.endMs,
    focus: [a.focus, b.focus].filter(Boolean).join('；'),
    keyWords: [...new Set([...a.keyWords, ...b.keyWords])],
  };
  return { ...plan, segments: [...segments.slice(0, i), merged, ...segments.slice(i + 2)] };
}

/**
 * 拖动一段的开始或结束到 t：不越过相邻片段，不短于 MIN_SEGMENT_MS，不超出 [0, duration]；
 * `snap` 为字幕边界时先吸附
 */
export function moveEdge(
  plan: VideoPlan,
  id: string,
  edge: 'start' | 'end',
  t: number,
  durationMs: number,
  snap?: { boundaries: number[]; withinMs: number }
): VideoPlan {
  const segments = sortSegments(plan.segments);
  const i = segments.findIndex((s) => s.id === id);
  if (i === -1) return plan;
  const seg = segments[i];
  let target = snap ? snapTime(t, snap.boundaries, snap.withinMs) : t;
  if (edge === 'start') {
    const min = i > 0 ? segments[i - 1].endMs : 0;
    target = Math.max(min, Math.min(target, seg.endMs - MIN_SEGMENT_MS));
  } else {
    const max = i < segments.length - 1 ? segments[i + 1].startMs : durationMs;
    target = Math.min(max, Math.max(target, seg.startMs + MIN_SEGMENT_MS));
  }
  const moved = edge === 'start' ? { ...seg, startMs: Math.round(target) } : { ...seg, endMs: Math.round(target) };
  return { ...plan, segments: segments.map((s) => (s.id === id ? moved : s)) };
}

/** 在空隙里新建一段 [start, end]（与已有片段重叠的部分裁掉）；放不下时返回 null */
export function addSegment(plan: VideoPlan, startMs: number, endMs: number): { plan: VideoPlan; id: string } | null {
  let [start, end] = startMs <= endMs ? [startMs, endMs] : [endMs, startMs];
  for (const s of plan.segments) {
    if (s.startMs <= start && start < s.endMs) start = s.endMs;
    if (s.startMs < end && end <= s.endMs) end = s.startMs;
  }
  if (end - start < MIN_SEGMENT_MS) return null;
  if (plan.segments.some((s) => s.startMs < end && start < s.endMs)) return null;
  const seg = emptySegment(Math.round(start), Math.round(end));
  return { plan: { ...plan, segments: sortSegments([...plan.segments, seg]) }, id: seg.id };
}

/** t 所在的片段 */
export function segmentAt(plan: VideoPlan, t: number): VideoSegment | undefined {
  return plan.segments.find((s) => s.startMs <= t && t < s.endMs);
}

/** 片段里的字幕（与片段重叠一半以上的） */
export function cuesIn(cues: Cue[], seg: Pick<VideoSegment, 'startMs' | 'endMs'>): Cue[] {
  return cues.filter((c) => {
    const overlap = Math.min(c.endMs, seg.endMs) - Math.max(c.startMs, seg.startMs);
    return overlap > 0 && overlap * 2 >= c.endMs - c.startMs;
  });
}

/**
 * 不用 AI 的自动切分：按字幕顺序累积，遇到较长的停顿（≥ gapMs）且已够 minMs，或累积到 maxMs，就切一段。
 * 片段从第一条字幕开始前 300ms 到最后一条结束后 300ms。
 */
export function autoSplit(cues: Cue[], durationMs: number, opts: { minMs: number; maxMs: number; gapMs?: number }): VideoSegment[] {
  const gapMs = opts.gapMs ?? 2000;
  const pad = 300;
  const groups: Cue[][] = [];
  let current: Cue[] = [];
  for (const cue of cues) {
    if (current.length > 0) {
      const first = current[0];
      const last = current[current.length - 1];
      const length = last.endMs - first.startMs;
      const gap = cue.startMs - last.endMs;
      if ((gap >= gapMs && length >= opts.minMs) || cue.endMs - first.startMs > opts.maxMs) {
        groups.push(current);
        current = [];
      }
    }
    current.push(cue);
  }
  if (current.length > 0) groups.push(current);
  const segments = groups.map((g) => emptySegment(Math.max(0, g[0].startMs - pad), Math.min(durationMs, g[g.length - 1].endMs + pad)));
  // 留白可能让相邻两段重叠：取中点
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].startMs < segments[i - 1].endMs) {
      const mid = Math.round((segments[i].startMs + segments[i - 1].endMs) / 2);
      segments[i - 1].endMs = mid;
      segments[i].startMs = mid;
    }
  }
  return segments;
}

export type SegmentIssue = 'short' | 'long' | 'no-subtitles' | 'untitled';

/** 一段的问题（编辑器底栏与片段列表提示） */
export function segmentIssues(seg: VideoSegment, cues: Cue[]): SegmentIssue[] {
  const issues: SegmentIssue[] = [];
  const length = seg.endMs - seg.startMs;
  if (length < SHORT_SEGMENT_MS) issues.push('short');
  if (length > LONG_SEGMENT_MS) issues.push('long');
  if (cuesIn(cues, seg).length === 0) issues.push('no-subtitles');
  if (!seg.title.trim()) issues.push('untitled');
  return issues;
}

export const ISSUE_TEXT: Record<SegmentIssue, string> = {
  short: '不到 10 秒',
  long: '超过 5 分钟',
  'no-subtitles': '没有字幕',
  untitled: '没有标题',
};

/** 撤销 / 重做栈 */
export interface History {
  past: VideoPlan[];
  present: VideoPlan;
  future: VideoPlan[];
}

const HISTORY_LIMIT = 100;

export function pushHistory(h: History, next: VideoPlan): History {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undo(h: History): History {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
