import React, { useRef } from 'react';
import { Captions, ChevronDown, CirclePause, EyeOff, Maximize, Minimize, Pause, Play, RotateCcw, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { PassageSentence } from '@/types/passage';
import { endOf, startOf, type Subtitles } from './ClipControls';

const RATES = [0.5, 0.75, 1, 1.25];

const SUBTITLE_LABEL: Record<Subtitles, string> = { both: '双语', en: '英文', zh: '中文', none: '关闭' };

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export interface PlayerBarProps {
  /** 主按钮在播（跟读时是正在跟读） */
  playing: boolean;
  /** 主按钮的说明（播放 / 暂停 / 开始跟读…） */
  playLabel: string;
  onToggle: () => void;
  onPrev: () => void;
  onReplay: () => void;
  onNext: () => void;
  durationMs: number;
  nowMs: number;
  sentences: PassageSentence[];
  active: number;
  onSeek: (ms: number) => void;
  rate: number;
  onRate: (rate: number) => void;
  volume: number;
  muted: boolean;
  onVolume: (volume: number) => void;
  onMute: (muted: boolean) => void;
  /** 画面字幕；不给时不显示这个按钮（盲听、精听） */
  subtitles?: Subtitles;
  onSubtitles?: (s: Subtitles) => void;
  /** 每句后暂停（理解）；不给时不显示这个按钮 */
  pauseEach?: boolean;
  onPauseEach?: (on: boolean) => void;
  /** 遮住画面（只听声音）；不给时不显示这个按钮 */
  cover?: boolean;
  onCover?: (cover: boolean) => void;
  fullscreen: boolean;
  /** 不给时不显示全屏按钮（跟读、精听：全屏会盖住右边的练习卡片） */
  onFullscreen?: () => void;
}

/** 控制条上的图标按钮（深色底），悬停说明带快捷键 */
const BarButton: React.FC<{ label: string; keys?: string; pressed?: boolean; onClick: () => void; children: React.ReactNode }> = ({ label, keys, pressed, onClick, children }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
        className={cn('size-8 text-white/85 hover:bg-white/15 hover:text-white', pressed && 'bg-white/20 text-white')}
      >
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent>
      {label}
      {keys && <span className="ml-1.5 opacity-60">{keys}</span>}
    </TooltipContent>
  </Tooltip>
);

/**
 * 视频控制条（视频下方，深色）：上面是按句分段的进度条（点击、拖动跳转），
 * 下面左边播放 / 暂停、上一句、重听这句、下一句、时间，右边速度、字幕、每句后暂停、遮住画面、音量、全屏。
 */
export const PlayerBar: React.FC<PlayerBarProps> = (p) => {
  const track = useRef<HTMLDivElement>(null);
  const total = Math.max(1, p.durationMs);
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / total) * 100))}%`;
  const at = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * total;
  };
  const quiet = p.muted || p.volume === 0;
  return (
    <div className="bg-black px-3 pt-1 pb-2 text-white select-none">
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={Math.round(total / 1000)}
        aria-valuenow={Math.round(p.nowMs / 1000)}
        aria-valuetext={`${clock(p.nowMs)} / ${clock(total)}`}
        onKeyDown={(e) => {
          // 焦点在进度条上时 ← → 前后跳 5 秒
          if (e.key === 'ArrowLeft') p.onSeek(Math.max(0, p.nowMs - 5000));
          else if (e.key === 'ArrowRight') p.onSeek(Math.min(total, p.nowMs + 5000));
          else return;
          e.preventDefault();
        }}
        className="group relative h-4 cursor-pointer outline-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          p.onSeek(at(e.clientX));
        }}
        onPointerMove={(e) => e.buttons === 1 && p.onSeek(at(e.clientX))}
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/20 transition-[height] group-hover:h-1.5">
          {p.sentences.map((s, i) => (
            <span
              key={i}
              className={cn('absolute inset-y-0 bg-white/25', i === p.active && 'bg-white/45')}
              style={{ left: pct(startOf(s)), width: `calc(${pct(endOf(s) - startOf(s))} - 1px)` }}
            />
          ))}
          <span className="absolute inset-y-0 left-0 bg-primary" style={{ width: pct(p.nowMs) }} />
        </div>
        <span
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full bg-primary transition-transform group-hover:scale-100 group-focus-visible:scale-100"
          style={{ left: pct(p.nowMs) }}
        />
      </div>
      <div className="flex items-center gap-0.5">
        <BarButton label={p.playLabel} keys="空格" onClick={p.onToggle}>
          {p.playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
        </BarButton>
        <BarButton label="上一句" keys="←" onClick={p.onPrev}>
          <SkipBack />
        </BarButton>
        <BarButton label="重听这句" keys="R" onClick={p.onReplay}>
          <RotateCcw />
        </BarButton>
        <BarButton label="下一句" keys="→" onClick={p.onNext}>
          <SkipForward />
        </BarButton>
        <span className="ml-2 text-xs text-white/80 tabular-nums">
          {clock(p.nowMs)} / {clock(total)}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-0.5 px-2 text-xs text-white/85 tabular-nums hover:bg-white/15 hover:text-white" aria-label="播放速度">
                {p.rate}x
                <ChevronDown className="size-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>播放速度</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={String(p.rate)} onValueChange={(v) => p.onRate(Number(v))}>
                {RATES.map((r) => (
                  <DropdownMenuRadioItem key={r} value={String(r)}>
                    {r}x
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {p.subtitles && p.onSubtitles && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="字幕"
                      className={cn('size-8 text-white/85 hover:bg-white/15 hover:text-white', p.subtitles === 'none' && 'text-white/45')}
                    >
                      <Captions />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>字幕：{SUBTITLE_LABEL[p.subtitles]}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>字幕</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={p.subtitles} onValueChange={(v) => p.onSubtitles?.(v as Subtitles)}>
                  {(Object.keys(SUBTITLE_LABEL) as Subtitles[]).map((k) => (
                    <DropdownMenuRadioItem key={k} value={k}>
                      {SUBTITLE_LABEL[k]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {p.pauseEach !== undefined && p.onPauseEach && (
            <BarButton label={p.pauseEach ? '每句后暂停：开' : '每句后暂停'} pressed={p.pauseEach} onClick={() => p.onPauseEach?.(!p.pauseEach)}>
              <CirclePause />
            </BarButton>
          )}
          {p.cover !== undefined && p.onCover && (
            <BarButton label={p.cover ? '显示画面' : '遮住画面，只听声音'} pressed={p.cover} onClick={() => p.onCover?.(!p.cover)}>
              <EyeOff />
            </BarButton>
          )}
          <div className="group/vol flex items-center">
            <BarButton label={quiet ? '取消静音' : '静音'} keys="M" onClick={() => p.onMute(!quiet)}>
              {quiet ? <VolumeX /> : <Volume2 />}
            </BarButton>
            <Slider
              aria-label="音量"
              value={[quiet ? 0 : p.volume * 100]}
              max={100}
              step={5}
              onValueChange={([v]) => {
                p.onVolume(v / 100);
                if (v > 0 && p.muted) p.onMute(false);
              }}
              className="w-0 opacity-0 transition-all group-hover/vol:mr-2 group-hover/vol:w-20 group-hover/vol:opacity-100 focus-within:mr-2 focus-within:w-20 focus-within:opacity-100"
            />
          </div>
          {p.onFullscreen && (
            <BarButton label={p.fullscreen ? '退出全屏' : '全屏'} keys="F" onClick={p.onFullscreen}>
              {p.fullscreen ? <Minimize /> : <Maximize />}
            </BarButton>
          )}
        </div>
      </div>
    </div>
  );
};
