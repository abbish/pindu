import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Mic, Pause, Play, Repeat, Square, Volume2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Toggle } from '@/components/ui/toggle';
import { InlineError } from '@/components/InlineError';
import { useRecorder } from '@/hooks/useRecorder';
import { cn } from '@/lib/utils';
import type { PassageSentence } from '@/types/passage';

export interface ShadowingPanelProps {
  sentence: PassageSentence | undefined;
  index: number;
  total: number;
  loop: boolean;
  onLoopChange: (loop: boolean) => void;
  /** 播完原声后自动开始录音 */
  autoRecord: boolean;
  onAutoRecordChange: (on: boolean) => void;
  /** 播放这一句原声 */
  onPlayOriginal: () => void;
  onStopOriginal: () => void;
  /** 原声正在播放这一句，进度 0–1 */
  originalProgress: number | null;
  /** 每播完一次这一句原声加 1（自动录音用） */
  originalEnded: number;
  onGo: (index: number) => void;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;

/** 音量条：实时（录音中）或录完的轮廓 */
const Bars: React.FC<{ values: number[]; slots?: number; className?: string }> = ({ values, slots = 60, className }) => {
  const padded = values.length >= slots ? values.slice(-slots) : [...Array(slots - values.length).fill(0), ...values];
  return (
    <div className={cn('flex h-10 items-center gap-[2px]', className)} aria-hidden>
      {padded.map((v, i) => (
        <span key={i} className="w-[3px] rounded-full bg-current transition-[height] duration-75" style={{ height: `${Math.max(6, Math.min(100, v * 160))}%`, opacity: v > 0 ? 1 : 0.25 }} />
      ))}
    </div>
  );
};

/** 录完的轮廓压成 60 条 */
const squeeze = (peaks: number[], slots = 60) =>
  peaks.length <= slots ? peaks : Array.from({ length: slots }, (_, i) => Math.max(...peaks.slice(Math.floor((i * peaks.length) / slots), Math.floor(((i + 1) * peaks.length) / slots))));

/**
 * 跟读一句：原声（播放中显示进度）→ 录音（麦克风提前打开，开始后才提示「开始说」，实时声波，说完停顿自动停）→
 * 回放我的录音（显示进度），对比原声与自己的时长。可开「播完原声自动录音」形成 听 → 说 的节奏。
 */
export const ShadowingPanel: React.FC<ShadowingPanelProps> = ({
  sentence,
  index,
  total,
  loop,
  onLoopChange,
  autoRecord,
  onAutoRecordChange,
  onPlayOriginal,
  onStopOriginal,
  originalProgress,
  originalEnded,
  onGo,
}) => {
  const originalMs = sentence ? Math.max(0, (sentence.endMs ?? 0) - (sentence.startMs ?? 0)) : 0;
  const recorder = useRecorder({ silenceStopMs: 1500, maxMs: Math.max(6000, originalMs * 3) });
  const [mineProgress, setMineProgress] = useState<number | null>(null);
  const mine = useRef<HTMLAudioElement | null>(null);

  // 进入跟读就打开麦克风，点录音不用再等
  useEffect(() => {
    void recorder.open();
    // 只在挂载时打开；卸载时 useRecorder 自己关闭
  }, [recorder.open]);

  // 换句：丢掉上一句的录音
  useEffect(() => {
    recorder.clear();
    mine.current?.pause();
    setMineProgress(null);
  }, [index, recorder.clear]);

  // 播完原声自动录音（循环时不自动录）
  const lastEnded = useRef(originalEnded);
  useEffect(() => {
    if (originalEnded !== lastEnded.current) {
      lastEnded.current = originalEnded;
      if (autoRecord && !loop && recorder.state === 'idle') void recorder.start();
    }
  }, [originalEnded, autoRecord, loop, recorder]);

  const record = () => {
    onStopOriginal();
    mine.current?.pause();
    void recorder.start();
  };

  const playMine = () => {
    if (!recorder.take) return;
    onStopOriginal();
    if (mineProgress !== null) {
      mine.current?.pause();
      setMineProgress(null);
      return;
    }
    const audio = new Audio(recorder.take.url);
    mine.current = audio;
    audio.ontimeupdate = () => setMineProgress(audio.duration ? audio.currentTime / audio.duration : 0);
    audio.onended = audio.onpause = () => setMineProgress(null);
    setMineProgress(0);
    void audio.play();
  };

  if (!sentence) return null;
  const recording = recorder.state === 'recording';
  const arming = recorder.state === 'arming';
  const originalPlaying = originalProgress !== null;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="tabular-nums">
          {index + 1} / {total}
        </span>
        <div className="flex gap-1">
          <Toggle size="sm" pressed={autoRecord} onPressedChange={onAutoRecordChange} aria-label="播完原声自动录音" title="播完原声自动录音">
            <Wand2 />
            自动录
          </Toggle>
          <Toggle size="sm" pressed={loop} onPressedChange={onLoopChange} aria-label="单句循环">
            <Repeat />
            循环
          </Toggle>
        </div>
      </div>

      <div>
        <div className="text-xl leading-snug font-medium">{sentence.en}</div>
        {sentence.zh && <div className="mt-1 text-sm text-muted-foreground">{sentence.zh}</div>}
      </div>

      {/* 录音状态与声波 */}
      <div
        className={cn(
          'flex h-20 flex-col justify-center rounded-lg border px-3',
          recording ? 'border-destructive/50 bg-destructive/5 text-destructive' : 'bg-muted/40 text-muted-foreground'
        )}
        aria-live="polite"
      >
        {recording ? (
          <>
            <div className="flex items-center gap-2 text-xs font-medium">
              <span className="size-2 animate-pulse rounded-full bg-destructive" />
              {recorder.heard ? '正在录音' : '请开始说'}
              <span className="ml-auto tabular-nums">{seconds(recorder.elapsedMs)}</span>
            </div>
            <Bars values={recorder.live} />
          </>
        ) : arming ? (
          <div className="flex items-center gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin" />
            准备麦克风…
          </div>
        ) : recorder.take ? (
          <>
            <div className="flex items-center gap-2 text-xs">
              我的录音
              <span className="ml-auto tabular-nums">
                原声 {seconds(originalMs)} · 我 {seconds(recorder.take.durationMs)}
              </span>
            </div>
            <Bars values={squeeze(recorder.take.peaks)} className="text-primary" />
          </>
        ) : (
          <div className="text-xs">{autoRecord ? '听完原声会自动开始录音' : '听原声，然后点「录音」跟着说'}</div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Button variant={originalPlaying ? 'secondary' : 'outline'} className="w-full" onClick={originalPlaying ? onStopOriginal : onPlayOriginal}>
            {originalPlaying ? <Pause /> : <Volume2 />}
            原声
          </Button>
          <Progress value={(originalProgress ?? 0) * 100} className={cn('h-1', !originalPlaying && 'invisible')} />
        </div>
        <div className="space-y-1">
          {recording || arming ? (
            <Button variant="destructive" className="w-full" onClick={recorder.stop} disabled={arming}>
              <Square />
              停止
            </Button>
          ) : (
            <Button className="w-full" onClick={record}>
              <Mic />
              {recorder.take ? '重录' : '录音'}
            </Button>
          )}
          <div className="h-1" />
        </div>
        <div className="space-y-1">
          <Button variant={mineProgress !== null ? 'secondary' : 'outline'} className="w-full" onClick={playMine} disabled={!recorder.take || recording}>
            {mineProgress !== null ? <Pause /> : <Play />}
            我的
          </Button>
          <Progress value={(mineProgress ?? 0) * 100} className={cn('h-1', mineProgress === null && 'invisible')} />
        </div>
      </div>
      {recorder.error && <InlineError>{recorder.error}</InlineError>}

      <div className="flex justify-between">
        <Button variant="ghost" size="sm" onClick={() => onGo(index - 1)} disabled={index === 0 || recording}>
          <ChevronLeft />
          上一句
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onGo(index + 1)} disabled={index >= total - 1 || recording}>
          下一句
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
};
