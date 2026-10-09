import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Cue, VideoSegment } from '@/types/video';
import { formatClock } from './time';

/** 每秒的波形峰值个数（与后端 media::PEAKS_PER_SECOND 一致） */
const PEAKS_PER_SECOND = 50;
const RULER_H = 22;
const THUMB_H = 44;
const WAVE_H = 44;
const CUE_H = 34;
const SEG_H = 46;
/** 边界拖动手柄的可点宽度 */
const HANDLE_PX = 8;

export interface TimelineProps {
  durationMs: number;
  /** 每秒多少像素 */
  zoom: number;
  cues: Cue[];
  segments: VideoSegment[];
  selectedId: string | null;
  playheadMs: number;
  thumbs: string[];
  thumbIntervalMs: number;
  peaks: number[];
  /** 播放时让播放头保持在视野里 */
  following: boolean;
  onSeek: (ms: number) => void;
  onSelect: (id: string | null) => void;
  /** 拖动边界：拖动中不断回调，松开时 done = true */
  onEdgeDrag: (id: string, edge: 'start' | 'end', ms: number, done: boolean, free: boolean) => void;
  /** 在片段轨的空白处拖出一段 */
  onCreate: (startMs: number, endMs: number) => void;
  /** 入点 / 出点（工具栏或 I / O 设的），在时间轴上标出；小旗可左右拖，两点之间的区域可整体平移 */
  marks: { in: number | null; out: number | null };
  onMarksChange: (marks: { in: number | null; out: number | null }) => void;
  /** 吸附打开时的字幕边界；拖动时贴近就显示对齐线（与父组件的吸附规则一致） */
  snapTo: number[] | null;
  /** 吸附距离（毫秒） */
  snapWithinMs: number;
}

/** 刻度间隔：让相邻刻度相距 ≥ 80px */
function tickStep(zoom: number): number {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
  return steps.find((s) => s * zoom >= 80) ?? 3600;
}

type Drag =
  | { kind: 'edge'; id: string; edge: 'start' | 'end' }
  | { kind: 'mark'; which: 'in' | 'out' }
  | { kind: 'range'; grabMs: number; inMs: number; outMs: number }
  | { kind: 'create'; fromMs: number; toMs: number }
  | { kind: 'scrub' };

/**
 * 剪辑编辑器的时间轴（自绘，可横向滚动与缩放）：刻度、缩略图、波形（画布只画可见部分）、字幕轨、片段轨、播放头。
 * 只渲染视野内的缩略图和字幕；片段边界可拖动（父组件负责吸附与撤销），空白处拖动新建片段，刻度 / 缩略图 / 波形上点击或拖动定位。
 */
export const Timeline: React.FC<TimelineProps> = ({
  durationMs,
  zoom,
  cues,
  segments,
  selectedId,
  playheadMs,
  thumbs,
  thumbIntervalMs,
  peaks,
  following,
  onSeek,
  onSelect,
  onEdgeDrag,
  onCreate,
  marks,
  onMarksChange,
  snapTo,
  snapWithinMs,
}) => {
  /** 正在拖动的位置贴近哪条字幕边界（显示对齐线） */
  const [guide, setGuide] = useState<number | null>(null);
  const snapPoint = useCallback(
    (ms: number, free: boolean) => {
      if (!snapTo || free) return null;
      let best: number | null = null;
      for (const b of snapTo) if (Math.abs(b - ms) <= snapWithinMs && (best === null || Math.abs(b - ms) < Math.abs(best - ms))) best = b;
      return best;
    },
    [snapTo, snapWithinMs]
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ left: 0, width: 800 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const width = Math.max(1, (durationMs / 1000) * zoom);
  const toMs = useCallback((x: number) => Math.max(0, Math.min(durationMs, (x / zoom) * 1000)), [durationMs, zoom]);
  const toX = (ms: number) => (ms / 1000) * zoom;

  const updateView = useCallback(() => {
    const el = scrollRef.current;
    if (el) setView({ left: el.scrollLeft, width: el.clientWidth });
  }, []);

  useEffect(() => {
    updateView();
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateView);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateView]);

  // 缩放时保持播放头在原来的屏幕位置
  const prevZoom = useRef(zoom);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || prevZoom.current === zoom) return;
    const screenX = (playheadMs / 1000) * prevZoom.current - el.scrollLeft;
    el.scrollLeft = Math.max(0, (playheadMs / 1000) * zoom - screenX);
    prevZoom.current = zoom;
    updateView();
  }, [zoom, playheadMs, updateView]);

  // 播放时跟随播放头
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !following) return;
    const x = toX(playheadMs);
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) {
      el.scrollLeft = Math.max(0, x - 80);
    }
  });

  // 波形：只画可见部分
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(view.width * ratio);
    canvas.height = Math.floor(WAVE_H * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, view.width, WAVE_H);
    ctx.fillStyle = getComputedStyle(canvas).color;
    const mid = WAVE_H / 2;
    for (let x = 0; x < view.width; x++) {
      const from = Math.floor(((view.left + x) / zoom) * PEAKS_PER_SECOND);
      const to = Math.max(from + 1, Math.floor(((view.left + x + 1) / zoom) * PEAKS_PER_SECOND));
      let peak = 0;
      for (let i = from; i < to && i < peaks.length; i++) peak = Math.max(peak, peaks[i]);
      const h = Math.max(1, peak * (WAVE_H - 4));
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
  }, [view, zoom, peaks]);

  // 拖动：全局监听，松开时结束
  useEffect(() => {
    if (!drag) return;
    const el = scrollRef.current;
    const xOf = (e: MouseEvent) => (el ? e.clientX - el.getBoundingClientRect().left + el.scrollLeft : 0);
    const move = (e: MouseEvent) => {
      const ms = toMs(xOf(e));
      if (drag.kind === 'range') {
        // 整体平移：保持长度，不出界
        const len = drag.outMs - drag.inMs;
        const start = Math.max(0, Math.min(durationMs - len, drag.inMs + ms - drag.grabMs));
        onMarksChange({ in: start, out: start + len });
        return;
      }
      if (drag.kind !== 'scrub') setGuide(snapPoint(ms, e.altKey));
      if (drag.kind === 'mark') {
        onMarksChange({ ...marksRef.current, [drag.which]: snapPoint(ms, e.altKey) ?? ms });
        return;
      }
      if (drag.kind === 'edge') onEdgeDrag(drag.id, drag.edge, ms, false, e.altKey);
      else if (drag.kind === 'create') setDrag({ ...drag, toMs: snapPoint(ms, e.altKey) ?? ms });
      else onSeek(ms);
    };
    const up = (e: MouseEvent) => {
      const ms = toMs(xOf(e));
      setGuide(null);
      if (drag.kind === 'edge') onEdgeDrag(drag.id, drag.edge, ms, true, e.altKey);
      else if (drag.kind === 'create' && Math.abs(ms - drag.fromMs) > 300) onCreate(drag.fromMs, ms);
      setDrag(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [drag, toMs, onEdgeDrag, onCreate, onSeek, snapPoint, onMarksChange, durationMs]);
  const marksRef = useRef(marks);
  marksRef.current = marks;

  const localX = (e: React.MouseEvent) => {
    const el = scrollRef.current!;
    return e.clientX - el.getBoundingClientRect().left + el.scrollLeft;
  };

  const startScrub = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    onSeek(toMs(localX(e)));
    setDrag({ kind: 'scrub' });
  };

  // 视野内的范围（多留一屏，滚动时不闪）
  const visibleFrom = toMs(view.left - view.width);
  const visibleTo = toMs(view.left + view.width * 2);
  const step = tickStep(zoom);
  const ticks: number[] = [];
  for (let s = Math.floor(visibleFrom / 1000 / step) * step; s * 1000 <= Math.min(durationMs, visibleTo); s += step) {
    if (s >= 0) ticks.push(s);
  }
  const thumbWidth = (thumbIntervalMs / 1000) * zoom;
  const firstThumb = Math.max(0, Math.floor(visibleFrom / thumbIntervalMs));
  const lastThumb = Math.min(thumbs.length - 1, Math.ceil(visibleTo / thumbIntervalMs));
  const visibleCues = cues.filter((c) => c.endMs >= visibleFrom && c.startMs <= visibleTo);
  const creating = drag?.kind === 'create' ? drag : null;

  return (
    <div
      ref={scrollRef}
      className="relative overflow-x-auto overflow-y-hidden select-none"
      onScroll={updateView}
      onWheel={(e) => {
        // 触控板横向滑动与 shift + 滚轮横向滚动由浏览器处理；纵向滚轮转成横向
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey && scrollRef.current) {
          scrollRef.current.scrollLeft += e.deltaY;
        }
      }}
    >
      <div className="relative" style={{ width, height: RULER_H + THUMB_H + WAVE_H + CUE_H + SEG_H + 8 }}>
        {/* 刻度 */}
        <div className="absolute inset-x-0 top-0 cursor-pointer border-b" style={{ height: RULER_H }} onMouseDown={startScrub}>
          {ticks.map((s) => (
            <div key={s} className="absolute top-0 h-full border-l border-border pl-1 text-[10px] leading-[22px] text-muted-foreground tabular-nums" style={{ left: toX(s * 1000) }}>
              {formatClock(s * 1000, false)}
            </div>
          ))}
        </div>

        {/* 缩略图 */}
        <div className="absolute inset-x-0 cursor-pointer overflow-hidden bg-muted/40" style={{ top: RULER_H, height: THUMB_H }} onMouseDown={startScrub}>
          {thumbs.slice(firstThumb, lastThumb + 1).map((src, i) => (
            <img
              key={firstThumb + i}
              src={src}
              alt=""
              draggable={false}
              loading="lazy"
              className="absolute top-0 h-full object-cover opacity-90"
              style={{ left: toX((firstThumb + i) * thumbIntervalMs), width: Math.max(thumbWidth, 1) }}
            />
          ))}
        </div>

        {/* 波形：画布固定在视野里 */}
        <div className="absolute inset-x-0 cursor-pointer" style={{ top: RULER_H + THUMB_H, height: WAVE_H }} onMouseDown={startScrub}>
          <canvas ref={canvasRef} className="absolute top-0 text-muted-foreground/60" style={{ left: view.left, width: view.width, height: WAVE_H }} />
        </div>

        {/* 字幕轨 */}
        <div className="absolute inset-x-0 border-t" style={{ top: RULER_H + THUMB_H + WAVE_H, height: CUE_H }}>
          {visibleCues.map((c) => (
            <button
              key={`${c.startMs}-${c.endMs}`}
              type="button"
              title={`${c.en}${c.zh ? `\n${c.zh}` : ''}`}
              className="absolute top-1 h-[26px] overflow-hidden rounded-sm border border-border bg-background px-1 text-left text-[11px] leading-[24px] whitespace-nowrap text-foreground/80 hover:bg-accent"
              style={{ left: toX(c.startMs), width: Math.max(2, toX(c.endMs - c.startMs)) }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => onSeek(c.startMs)}
            >
              {c.en}
            </button>
          ))}
        </div>

        {/* 片段轨：空白处拖动新建（十字光标；起点也吸附到字幕边界） */}
        <div
          className="absolute inset-x-0 cursor-crosshair border-t bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,var(--color-muted)_6px,var(--color-muted)_7px)]"
          style={{ top: RULER_H + THUMB_H + WAVE_H + CUE_H, height: SEG_H }}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            const raw = toMs(localX(e));
            const ms = snapPoint(raw, e.altKey) ?? raw;
            onSelect(null);
            setGuide(snapPoint(raw, e.altKey));
            setDrag({ kind: 'create', fromMs: ms, toMs: ms });
          }}
        >
          {segments.length === 0 && !creating && (
            <div className="pointer-events-none absolute top-0 flex h-full items-center px-3 text-xs text-muted-foreground" style={{ left: view.left }}>
              在这里拖动新建片段
            </div>
          )}
          {segments.map((s, i) => {
            const selected = s.id === selectedId;
            return (
              <div
                key={s.id}
                role="button"
                tabIndex={-1}
                className={cn(
                  'absolute top-1 bottom-1 overflow-hidden rounded-md border text-xs',
                  selected ? 'border-primary bg-primary/25 ring-2 ring-primary/40' : 'border-primary/40 bg-primary/12 hover:bg-primary/20'
                )}
                style={{ left: toX(s.startMs), width: Math.max(2, toX(s.endMs - s.startMs)) }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  if (e.button !== 0) return;
                  onSelect(s.id);
                  onSeek(s.startMs);
                }}
              >
                <div className="truncate px-2 pt-1 font-medium">
                  <span className="mr-1 text-muted-foreground tabular-nums">{i + 1}</span>
                  {s.title || '未命名'}
                </div>
                <div className="truncate px-2 text-[10px] text-muted-foreground tabular-nums">{formatClock(s.endMs - s.startMs, false)}</div>
                {(['start', 'end'] as const).map((edge) => (
                  <div
                    key={edge}
                    className={cn('absolute top-0 h-full cursor-ew-resize hover:bg-primary/40', edge === 'start' ? 'left-0' : 'right-0')}
                    style={{ width: HANDLE_PX }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      if (e.button !== 0) return;
                      onSelect(s.id);
                      setDrag({ kind: 'edge', id: s.id, edge });
                    }}
                  />
                ))}
              </div>
            );
          })}
          {creating && (
            <div
              className="absolute top-1 bottom-1 rounded-md border border-dashed border-primary bg-primary/10"
              style={{ left: toX(Math.min(creating.fromMs, creating.toMs)), width: toX(Math.abs(creating.toMs - creating.fromMs)) }}
            />
          )}
        </div>

        {/* 入点 / 出点：之间高亮，两端小旗 */}
        {marks.in !== null && marks.out !== null && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 bg-primary/10"
            style={{ left: toX(Math.min(marks.in, marks.out)), width: toX(Math.abs(marks.out - marks.in)) }}
          />
        )}
        {/* 刻度行里两点之间：按住整体平移 */}
        {marks.in !== null && marks.out !== null && (
          <div
            className="absolute top-0 cursor-grab active:cursor-grabbing"
            style={{ left: toX(Math.min(marks.in, marks.out)), width: toX(Math.abs(marks.out - marks.in)), height: RULER_H }}
            onMouseDown={(e) => {
              if (e.button !== 0 || marks.in === null || marks.out === null) return;
              e.stopPropagation();
              setDrag({ kind: 'range', grabMs: toMs(localX(e)), inMs: Math.min(marks.in, marks.out), outMs: Math.max(marks.in, marks.out) });
            }}
          />
        )}
        {(['in', 'out'] as const).map((k) => {
          const at = marks[k];
          return at === null ? null : (
            <div key={k} className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary" style={{ left: toX(at) }}>
              {/* 小旗与刻度行里的竖线可以拖 */}
              <span
                role="slider"
                aria-label={k === 'in' ? '入点' : '出点'}
                aria-valuenow={Math.round(at / 1000)}
                className={cn(
                  'pointer-events-auto absolute top-0 cursor-ew-resize rounded-sm bg-primary px-1 text-[10px] leading-4 text-primary-foreground shadow-sm',
                  k === 'in' ? 'left-0' : 'right-0'
                )}
                style={{ height: RULER_H, lineHeight: `${RULER_H}px` }}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  setDrag({ kind: 'mark', which: k });
                }}
              >
                {k === 'in' ? '入' : '出'}
              </span>
            </div>
          );
        })}

        {/* 吸附对齐线：拖动时贴到字幕边界 */}
        {guide !== null && <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-warning" style={{ left: toX(guide) }} />}

        {/* 播放头 */}
        <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-destructive" style={{ left: toX(playheadMs) }}>
          <div className="absolute -top-0.5 -left-1 size-2.5 rotate-45 bg-destructive" />
        </div>
      </div>
    </div>
  );
};
