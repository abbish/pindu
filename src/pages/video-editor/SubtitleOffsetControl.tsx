import React from 'react';
import { Captions, Crosshair, Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Cue } from '@/types/video';
import { alignedOffset, nearestCue } from './plan';

export interface SubtitleOffsetControlProps {
  /** 当前偏移（毫秒，正数 = 字幕延后） */
  offsetMs: number;
  /** 已按当前偏移换算的字幕 */
  cues: Cue[];
  playheadMs: number;
  /** 已经切出过短片（改偏移不会重切它们） */
  hasClips: boolean;
  disabled?: boolean;
  onChange: (offsetMs: number) => void;
}

const fmt = (ms: number) => `${ms > 0 ? '+' : ms < 0 ? '−' : ''}${(Math.abs(ms) / 1000).toFixed(1)} 秒`;

/**
 * 字幕纠偏（播放器常见的「字幕提前 / 延后」）：按 0.1 / 1 秒调整，或把离播放头最近的一句对齐到播放头。
 * 不改字幕原始时间，显示、规划与切分都按偏移换算。
 */
export const SubtitleOffsetControl: React.FC<SubtitleOffsetControlProps> = ({ offsetMs, cues, playheadMs, hasClips, disabled, onChange }) => {
  const near = nearestCue(cues, playheadMs);
  const step = (ms: number) => onChange(offsetMs + ms);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8" disabled={disabled} aria-label="字幕时间">
          <Captions />
          {offsetMs !== 0 && <span className="tabular-nums">{fmt(offsetMs)}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">字幕时间</span>
          <span className="text-sm tabular-nums">{offsetMs === 0 ? '未调整' : fmt(offsetMs)}</span>
        </div>
        <div className="grid grid-cols-4 gap-1">
          <Button variant="outline" size="sm" onClick={() => step(-1000)}>
            −1 秒
          </Button>
          <Button variant="outline" size="sm" onClick={() => step(-100)} aria-label="提前 0.1 秒">
            <Minus />
            0.1
          </Button>
          <Button variant="outline" size="sm" onClick={() => step(100)} aria-label="延后 0.1 秒">
            <Plus />
            0.1
          </Button>
          <Button variant="outline" size="sm" onClick={() => step(1000)}>
            +1 秒
          </Button>
        </div>
        {near && (
          <div className="space-y-1.5 rounded-md bg-muted p-2">
            <p className="line-clamp-2 text-xs text-muted-foreground">{near.en}</p>
            <Button variant="outline" size="sm" className="w-full" onClick={() => onChange(alignedOffset(offsetMs, near.startMs, playheadMs))}>
              <Crosshair />
              这句从这里开始
            </Button>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          {hasClips ? <span className="text-xs text-muted-foreground">已切出的短片不受影响</span> : <span />}
          <Button variant="ghost" size="sm" disabled={offsetMs === 0} onClick={() => onChange(0)}>
            <RotateCcw />
            还原
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
