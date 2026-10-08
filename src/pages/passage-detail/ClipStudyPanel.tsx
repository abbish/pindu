import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Ear, Eye, EyeOff, Mic, Pause, Play, Repeat, Square, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { InlineError } from '@/components/InlineError';
import { cn } from '@/lib/utils';
import type { PassageSentence } from '@/types/passage';
import type { PassageVideo } from '@/types/video';

type Mode = 'study' | 'shadow' | 'listen';
type Subtitles = 'both' | 'en' | 'zh' | 'none';

const RATES = [0.5, 0.75, 1, 1.25];

export interface ClipStudyPanelProps {
  video: PassageVideo;
  sentences: PassageSentence[];
  /** 听力模式里「做题」 */
  onPractice?: () => void;
}

/** 句子在短片里的时间（没有时间的句子按 0） */
const startOf = (s: PassageSentence) => s.startMs ?? 0;
const endOf = (s: PassageSentence) => s.endMs ?? startOf(s);

/**
 * 视频短片的学习面板：
 * - 场景学习：视频 + 字幕（双语 / 英 / 中 / 隐藏），台词列表跟随高亮，点台词跳过去；
 * - 跟读：一句一句播，播完自动停；录自己的声音，和原声对比回放；可单句循环、放慢；
 * - 听力：先隐藏字幕看，看完再显示字幕核对，然后做题。
 */
export const ClipStudyPanel: React.FC<ClipStudyPanelProps> = ({ video, sentences, onPractice }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('study');
  const [subtitles, setSubtitles] = useState<Subtitles>('both');
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [current, setCurrent] = useState(0);
  const [loop, setLoop] = useState(false);
  const [revealed, setRevealed] = useState(false);
  /** 播到这里自动停（跟读的单句播放） */
  const stopAt = useRef<number | null>(null);

  const active = sentences.findIndex((s) => startOf(s) <= now && now < endOf(s));
  const shown: Subtitles = mode === 'listen' && !revealed ? 'none' : subtitles;
  const line = active >= 0 ? sentences[active] : null;

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate]);

  // 播放头（requestAnimationFrame 比 timeupdate 准，单句播放要停得准）
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        const t = v.currentTime * 1000;
        if (stopAt.current !== null && t >= stopAt.current) {
          const end = stopAt.current;
          if (loop && mode === 'shadow') {
            v.currentTime = startOf(sentences[current]) / 1000;
          } else {
            stopAt.current = null;
            v.pause();
            v.currentTime = end / 1000;
          }
        }
        setNow(v.currentTime * 1000);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, loop, mode, current, sentences]);

  // 场景学习：台词列表跟着滚
  useEffect(() => {
    if (mode !== 'study' || active < 0) return;
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active, mode]);

  const seek = (ms: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = ms / 1000;
    setNow(ms);
  };

  const playSentence = useCallback(
    (index: number) => {
      const s = sentences[index];
      const v = videoRef.current;
      if (!s || !v) return;
      setCurrent(index);
      v.currentTime = startOf(s) / 1000;
      stopAt.current = endOf(s);
      void v.play();
    },
    [sentences]
  );

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      stopAt.current = mode === 'shadow' ? endOf(sentences[current]) : null;
      if (mode === 'shadow') v.currentTime = startOf(sentences[current]) / 1000;
      void v.play();
    } else {
      v.pause();
    }
  };

  const changeMode = (next: Mode) => {
    videoRef.current?.pause();
    stopAt.current = null;
    setMode(next);
    setRevealed(false);
    if (next === 'shadow') {
      setCurrent(Math.max(0, active));
      seek(startOf(sentences[Math.max(0, active)] ?? sentences[0]));
    }
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-6">
      <div className="flex flex-col gap-3">
        <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
          <video
            ref={videoRef}
            src={video.clipUrl}
            poster={video.posterUrl ?? undefined}
            className="size-full object-contain"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onSeeked={() => videoRef.current && setNow(videoRef.current.currentTime * 1000)}
            onClick={togglePlay}
            preload="auto"
          />
          {line && shown !== 'none' && (
            <div className="pointer-events-none absolute inset-x-6 bottom-5 text-center">
              <span className="inline-block rounded bg-black/70 px-3 py-1 text-lg leading-snug text-white">
                {shown !== 'zh' && line.en}
                {shown !== 'en' && line.zh && <span className={cn('block', shown === 'both' && 'text-sm text-white/80')}>{line.zh}</span>}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" value={mode} onValueChange={(v) => v && changeMode(v as Mode)} variant="outline">
            <ToggleGroupItem value="study" className="px-3">
              <Eye />
              场景学习
            </ToggleGroupItem>
            <ToggleGroupItem value="shadow" className="px-3">
              <Mic />
              跟读
            </ToggleGroupItem>
            <ToggleGroupItem value="listen" className="px-3">
              <Ear />
              听力
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={togglePlay} aria-label={playing ? '暂停' : '播放'}>
              {playing ? <Pause /> : <Play />}
            </Button>
            {mode !== 'listen' && (
              <Select value={subtitles} onValueChange={(v) => setSubtitles(v as Subtitles)}>
                <SelectTrigger size="sm" className="w-24" aria-label="字幕">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">双语</SelectItem>
                  <SelectItem value="en">英文</SelectItem>
                  <SelectItem value="zh">中文</SelectItem>
                  <SelectItem value="none">无字幕</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Select value={String(rate)} onValueChange={(v) => setRate(Number(v))}>
              <SelectTrigger size="sm" className="w-20" aria-label="播放速度">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RATES.map((r) => (
                  <SelectItem key={r} value={String(r)}>
                    {r}x
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Card className="gap-0 overflow-hidden p-0">
        {mode === 'study' && (
          <div ref={listRef} className="max-h-[520px] overflow-y-auto p-2">
            {sentences.map((s, i) => (
              <button
                key={i}
                type="button"
                data-index={i}
                className={cn('block w-full rounded-md px-3 py-2 text-left hover:bg-muted', i === active && 'bg-accent')}
                onClick={() => {
                  seek(startOf(s));
                  void videoRef.current?.play();
                }}
              >
                <div className="text-sm">{s.en}</div>
                {s.zh && <div className="text-xs text-muted-foreground">{s.zh}</div>}
              </button>
            ))}
          </div>
        )}
        {mode === 'shadow' && (
          <ShadowingPanel
            sentence={sentences[current]}
            index={current}
            total={sentences.length}
            loop={loop}
            onLoopChange={setLoop}
            onPlay={() => playSentence(current)}
            onGo={(i) => {
              videoRef.current?.pause();
              setCurrent(i);
              seek(startOf(sentences[i]));
            }}
            onPauseVideo={() => videoRef.current?.pause()}
          />
        )}
        {mode === 'listen' && (
          <div className="space-y-3 p-4">
            <div className="text-sm font-medium">{revealed ? '对照字幕' : '先只听，不看字幕'}</div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setRevealed((r) => !r)}>
                {revealed ? <EyeOff /> : <Eye />}
                {revealed ? '隐藏字幕' : '显示字幕'}
              </Button>
              {onPractice && (
                <Button size="sm" onClick={onPractice}>
                  做听力题
                </Button>
              )}
            </div>
            {revealed && (
              <div className="max-h-[420px] space-y-2 overflow-y-auto">
                {sentences.map((s, i) => (
                  <div key={i} className={cn('rounded-md px-2 py-1 text-sm', i === active && 'bg-accent')}>
                    {s.en}
                    {s.zh && <div className="text-xs text-muted-foreground">{s.zh}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};

interface ShadowingPanelProps {
  sentence: PassageSentence | undefined;
  index: number;
  total: number;
  loop: boolean;
  onLoopChange: (loop: boolean) => void;
  onPlay: () => void;
  onGo: (index: number) => void;
  onPauseVideo: () => void;
}

/** 跟读：当前一句、播放原声、录音 / 回放自己的声音、上一句 / 下一句 */
const ShadowingPanel: React.FC<ShadowingPanelProps> = ({ sentence, index, total, loop, onLoopChange, onPlay, onGo, onPauseVideo }) => {
  const [recording, setRecording] = useState(false);
  const [takeUrl, setTakeUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  // 换句时丢掉上一句的录音
  useEffect(() => {
    setTakeUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });
    setError(null);
  }, [index]);

  useEffect(
    () => () => {
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    []
  );

  const start = async () => {
    setError(null);
    onPauseVideo();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setTakeUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(new Blob(chunks, { type: rec.mimeType }));
        });
      };
      rec.start();
      recorder.current = rec;
      setRecording(true);
    } catch {
      setError('无法使用麦克风，请在系统设置里允许拼读使用麦克风');
    }
  };

  const stop = () => {
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
  };

  const playTake = () => {
    if (!takeUrl) return;
    onPauseVideo();
    audio.current?.pause();
    audio.current = new Audio(takeUrl);
    void audio.current.play();
  };

  if (!sentence) return null;
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="tabular-nums">
          {index + 1} / {total}
        </span>
        <Toggle size="sm" pressed={loop} onPressedChange={onLoopChange} aria-label="单句循环">
          <Repeat />
          循环
        </Toggle>
      </div>
      <div>
        <div className="text-lg leading-snug font-medium">{sentence.en}</div>
        {sentence.zh && <div className="mt-1 text-sm text-muted-foreground">{sentence.zh}</div>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Button variant="outline" onClick={onPlay}>
          <Volume2 />
          原声
        </Button>
        {recording ? (
          <Button variant="destructive" onClick={stop}>
            <Square />
            停止
          </Button>
        ) : (
          <Button onClick={start}>
            <Mic />
            {takeUrl ? '重录' : '录音'}
          </Button>
        )}
        <Button variant="outline" onClick={playTake} disabled={!takeUrl || recording}>
          <Play />
          我的
        </Button>
      </div>
      {error && <InlineError>{error}</InlineError>}
      <div className="flex justify-between">
        <Button variant="ghost" size="sm" onClick={() => onGo(index - 1)} disabled={index === 0}>
          <ChevronLeft />
          上一句
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onGo(index + 1)} disabled={index >= total - 1}>
          下一句
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
};
