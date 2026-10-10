import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ear, Eye, Mic, Pause, Play, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { PassageReader, type TranslationMode } from '@/components/PassageReader';
import { TargetWord } from '@/components/PassageReader/WordCard';
import { SelectionAction } from '@/components/SelectionAction';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { canAddTarget } from '@/utils/passage';
import { useTargetWordInfo } from './useTargetWordInfo';
import { cn } from '@/lib/utils';
import { SentenceAnalysisPanel } from '@/components/SentenceAnalysis';
import type { Passage, PassageSentence } from '@/types/passage';
import type { PassageVideo } from '@/types/video';
import { ListenBuildPanel } from './ListenBuildPanel';
import { ShadowingPanel } from './ShadowingPanel';

type Mode = 'study' | 'shadow' | 'listen';
type Subtitles = 'both' | 'en' | 'zh' | 'none';

const RATES = [0.5, 0.75, 1, 1.25];
const SLOW_RATE = 0.75;

/** 练习条件（记在本机，下次打开沿用） */
interface ClipPrefs {
  /** 画面上的字幕 */
  subtitles: Subtitles;
  /** 右侧台词：显示 / 隐藏（只看画面） */
  showText: boolean;
  /** 右侧台词的翻译 */
  translation: TranslationMode;
  /** 聚焦：当前句放大，上下文渐隐 */
  focusBlur: boolean;
  /** 场景学习：每句播完自动暂停 */
  pauseEach: boolean;
  /** 跟读：播完原声自动录音 */
  autoRecord: boolean;
}

const PREFS_KEY = 'passage.clipStudy.v1';
const DEFAULT_PREFS: ClipPrefs = { subtitles: 'both', showText: true, translation: 'all', focusBlur: true, pauseEach: false, autoRecord: false };

function loadPrefs(): ClipPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<ClipPrefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export interface ClipStudyPanelProps {
  video: PassageVideo;
  sentences: PassageSentence[];
  /** 短文（片段）：目标词的点词卡片与选词加入目标词用 */
  passage: Pick<Passage, 'id' | 'targetWords'>;
  /** 台词里选中一个词，加成目标词 */
  onAddTarget?: (word: string, stay?: boolean) => void;
  /** 打开这个目标词的完整单词卡 */
  onOpenWord?: (word: string) => void;
  /** 有阅读理解题时「做听力题」 */
  onPractice?: () => void;
}

/** 句子在短片里的时间（没有时间的句子按 0） */
const startOf = (s: PassageSentence | undefined) => s?.startMs ?? 0;
const endOf = (s: PassageSentence | undefined) => s?.endMs ?? startOf(s);

/**
 * 视频短片的学习面板：
 * - 场景学习：视频 + 右侧台词（与朗读一样：当前句放大、上下文渐隐、重点词标出），点台词跳过去；可每句后暂停；
 * - 跟读：一句一句播，录音与原声对比（见 ShadowingPanel）；
 * - 听力：每句只听不看，用单词卡拼出听到的句子，拼对后画面才显示这句字幕（见 ListenBuildPanel）。
 * 「练习设置」里调画面字幕、台词显示、翻译、聚焦与自动暂停。
 */
/** 选中的文字是一个英文单词（可以加成目标词） */
/** 选中的文字是一个英文单词或 2–6 个词的词组（可以加成目标词） */

export const ClipStudyPanel: React.FC<ClipStudyPanelProps> = ({ video, sentences, passage, onAddTarget, onOpenWord, onPractice }) => {
  const targetWords = useMemo(() => passage.targetWords.map((w) => w.word), [passage.targetWords]);
  /** 正在看分析的台词 */
  const [analyzing, setAnalyzing] = useState<number | null>(null);
  const wordInfo = useTargetWordInfo(passage);
  const wordAudio = useAudioPlayer();
  const videoRef = useRef<HTMLVideoElement>(null);
  const textBox = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('study');
  const [prefs, setPrefs] = useState<ClipPrefs>(loadPrefs);
  // 听句拼句、隐藏台词时不看句子分析（分析里有整句台词）
  useEffect(() => {
    if (mode !== 'study' || !prefs.showText) setAnalyzing(null);
  }, [mode, prefs.showText]);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [current, setCurrent] = useState(0);
  const [loop, setLoop] = useState(false);
  /** 听力里拼好的句子：画面上可以显示它的字幕 */
  const [solved, setSolved] = useState<Set<number>>(new Set());
  /** 跟读：每播完一次当前句原声加 1 */
  const [originalEnded, setOriginalEnded] = useState(0);
  /** 播到这里自动停（单句播放 / 每句后暂停） */
  const stopAt = useRef<number | null>(null);
  /** 这次播放是单句原声（跟读、听力用） */
  const sentencePlay = useRef(false);
  /** 每句后暂停：正在播的那句（播过它的结尾就停）；播放中改开关也立刻生效 */
  const pauseEachRef = useRef(false);
  pauseEachRef.current = mode === 'study' && prefs.pauseEach;
  const playingSentence = useRef<number | null>(null);
  const [durationMs, setDurationMs] = useState(0);

  const updatePrefs = (patch: Partial<ClipPrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // 本机存不了就只在这次生效
      }
      return next;
    });

  const active = sentences.findIndex((s) => startOf(s) <= now && now < endOf(s));
  const line = active >= 0 ? sentences[active] : null;
  // 听力：没拼好的句子不显示字幕；跟读 / 场景学习按设置
  const shown: Subtitles = mode === 'listen' ? (active >= 0 && solved.has(active) ? 'both' : 'none') : prefs.subtitles;

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
          if (loop && mode === 'shadow' && sentencePlay.current) {
            v.currentTime = startOf(sentences[current]) / 1000;
          } else {
            stopAt.current = null;
            v.pause();
            v.currentTime = end / 1000;
            v.playbackRate = rate;
            if (sentencePlay.current) setOriginalEnded((n) => n + 1);
            sentencePlay.current = false;
          }
        } else if (pauseEachRef.current && !sentencePlay.current) {
          const done = playingSentence.current;
          if (done !== null && sentences[done] && t >= endOf(sentences[done])) {
            // 播完这一句：停在句尾，下次播放从下一句开始
            playingSentence.current = null;
            v.pause();
            v.currentTime = endOf(sentences[done]) / 1000;
          } else {
            const i = sentences.findIndex((x) => startOf(x) <= t && t < endOf(x));
            if (i >= 0) playingSentence.current = i;
          }
        }
        setNow(v.currentTime * 1000);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, loop, mode, current, sentences, rate]);

  const seek = (ms: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = ms / 1000;
    playingSentence.current = null;
    setNow(ms);
  };

  /** 只播一句（跟读原声、听力）；slow 时这一句用慢速 */
  const playSentence = useCallback(
    (index: number, slow = false) => {
      const s = sentences[index];
      const v = videoRef.current;
      if (!s || !v) return;
      setCurrent(index);
      v.currentTime = startOf(s) / 1000;
      v.playbackRate = slow ? SLOW_RATE : rate;
      stopAt.current = endOf(s);
      sentencePlay.current = true;
      void v.play();
    },
    [sentences, rate]
  );

  const pause = () => {
    videoRef.current?.pause();
    stopAt.current = null;
    sentencePlay.current = false;
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (!v.paused) return pause();
    if (mode === 'shadow') return playSentence(current);
    if (mode === 'listen') return playSentence(current);
    // 场景学习：每句后暂停由播放头跟踪（见上面的 tick）
    stopAt.current = null;
    playingSentence.current = null;
    sentencePlay.current = false;
    void v.play();
  };

  const changeMode = (next: Mode) => {
    pause();
    setMode(next);
    if (next === 'shadow' || next === 'listen') {
      const i = next === 'listen' ? 0 : Math.max(0, active);
      setCurrent(i);
      seek(startOf(sentences[i]));
    }
    if (next === 'listen') setSolved(new Set());
  };

  const originalProgress =
    mode === 'shadow' && playing && sentencePlay.current && sentences[current]
      ? Math.min(1, Math.max(0, (now - startOf(sentences[current])) / Math.max(1, endOf(sentences[current]) - startOf(sentences[current]))))
      : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_380px] items-stretch gap-6">
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
            onLoadedMetadata={(e) => setDurationMs(e.currentTarget.duration * 1000)}
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

        <ClipTimeline
          durationMs={durationMs || endOf(sentences[sentences.length - 1])}
          nowMs={now}
          sentences={sentences}
          active={active}
          onSeek={(ms) => {
            seek(ms);
            if (mode !== 'study') {
              stopAt.current = null;
              sentencePlay.current = false;
            }
          }}
        />

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
            {mode !== 'listen' && <PrefsPopover mode={mode} prefs={prefs} onChange={updatePrefs} />}
          </div>
        </div>
      </div>

      {/* 右侧与左侧（视频 + 时间轴 + 控制栏）同高，内容多时在里面滚动 */}
      <div className="relative min-h-[360px]">
      <Card className="absolute inset-0 flex flex-col gap-0 overflow-hidden p-0">
        {mode === 'study' && (
          <div ref={textBox} className="min-h-0 flex-1 overflow-y-auto p-3">
            <SelectionAction
              label="加入目标词"
              accept={(text) => Boolean(onAddTarget) && canAddTarget(text, targetWords)}
              onAction={(text) => onAddTarget?.(text)}
            >
            <PassageReader
              onAnalyzeSentence={setAnalyzing}
              analyzing={analyzing}
              scrollContainer={textBox}
              sentences={sentences}
              current={active >= 0 ? active : null}
              translation={prefs.translation}
              highlight={targetWords}
              focusBlur={prefs.focusBlur}
              hidden={!prefs.showText}
              onPlaySentence={(i) => {
                seek(startOf(sentences[i]));
                stopAt.current = null;
                playingSentence.current = i;
                sentencePlay.current = false;
                void videoRef.current?.play();
              }}
              renderTarget={(text, target, active) => (
                <TargetWord
                  text={text}
                  target={target}
                  active={active}
                  word={wordInfo.get(target.toLowerCase())}
                  onSpeak={(w, slow) => {
                    videoRef.current?.pause();
                    wordAudio.playText(w, undefined, { style: 'word', speed: slow ? 'slow' : 'normal' }).catch(() => {});
                  }}
                  onOpenCard={onOpenWord ? () => onOpenWord(target) : undefined}
                />
              )}
            />
            </SelectionAction>
          </div>
        )}
        {mode === 'shadow' && (
          <div className="min-h-0 flex-1 overflow-y-auto">
          <ShadowingPanel
            sentence={sentences[current]}
            index={current}
            total={sentences.length}
            loop={loop}
            onLoopChange={setLoop}
            autoRecord={prefs.autoRecord}
            onAutoRecordChange={(autoRecord) => updatePrefs({ autoRecord })}
            onPlayOriginal={() => playSentence(current)}
            onStopOriginal={pause}
            originalProgress={originalProgress}
            originalEnded={originalEnded}
            onGo={(i) => {
              pause();
              setCurrent(i);
              seek(startOf(sentences[i]));
            }}
          />
          </div>
        )}
        {mode === 'listen' && (
          <div className="min-h-0 flex-1 overflow-y-auto">
          <ListenBuildPanel
            sentences={sentences}
            index={current}
            onIndexChange={(i) => {
              pause();
              setCurrent(i);
              seek(startOf(sentences[i]));
            }}
            onPlay={playSentence}
            onSolved={(i) => setSolved((s) => new Set(s).add(i))}
            onPractice={onPractice}
          />
          </div>
        )}
      </Card>
      </div>
      {analyzing !== null && (
        <SentenceAnalysisPanel passageId={passage.id} sentences={sentences} index={analyzing} onIndexChange={setAnalyzing} targets={targetWords} onAddTarget={onAddTarget && ((w) => onAddTarget(w, true))} onClose={() => setAnalyzing(null)} />
      )}
    </div>
  );
};

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * 视频下方的时间轴：进度、当前 / 总时长；每句台词一小段（当前句高亮），点击或拖动跳转。
 */
const ClipTimeline: React.FC<{
  durationMs: number;
  nowMs: number;
  sentences: PassageSentence[];
  active: number;
  onSeek: (ms: number) => void;
}> = ({ durationMs, nowMs, sentences, active, onSeek }) => {
  const track = useRef<HTMLDivElement>(null);
  const total = Math.max(1, durationMs);
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / total) * 100))}%`;
  const at = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * total;
  };
  return (
    <div className="flex items-center gap-3 select-none">
      <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{clock(nowMs)}</span>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={Math.round(total / 1000)}
        aria-valuenow={Math.round(nowMs / 1000)}
        className="group relative h-5 flex-1 cursor-pointer outline-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onSeek(at(e.clientX));
        }}
        onPointerMove={(e) => e.buttons === 1 && onSeek(at(e.clientX))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onSeek(Math.max(0, nowMs - 5000));
          if (e.key === 'ArrowRight') onSeek(Math.min(total, nowMs + 5000));
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-muted">
          {sentences.map((s, i) => (
            <span
              key={i}
              className={cn('absolute inset-y-0 bg-foreground/15', i === active && 'bg-primary/40')}
              style={{ left: pct(startOf(s)), width: `calc(${pct(endOf(s) - startOf(s))} - 1px)` }}
            />
          ))}
          <span className="absolute inset-y-0 left-0 bg-primary" style={{ width: pct(nowMs) }} />
        </div>
        <span
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow transition-transform group-hover:scale-125 group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50"
          style={{ left: pct(nowMs) }}
        />
      </div>
      <span className="w-10 text-xs text-muted-foreground tabular-nums">{clock(total)}</span>
    </div>
  );
};

/** 练习设置：画面字幕；场景学习另有台词显示、翻译、聚焦、每句后暂停 */
const PrefsPopover: React.FC<{ mode: Mode; prefs: ClipPrefs; onChange: (patch: Partial<ClipPrefs>) => void }> = ({ mode, prefs, onChange }) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="sm">
        <Settings2 />
        练习设置
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-72 space-y-4">
      <Row label="画面字幕">
        <Select value={prefs.subtitles} onValueChange={(v) => onChange({ subtitles: v as Subtitles })}>
          <SelectTrigger size="sm" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="both">双语</SelectItem>
            <SelectItem value="en">英文</SelectItem>
            <SelectItem value="zh">中文</SelectItem>
            <SelectItem value="none">关闭</SelectItem>
          </SelectContent>
        </Select>
      </Row>
      {mode === 'study' && (
        <>
          <Row label="显示台词列表" htmlFor="cs-text">
            <Switch id="cs-text" checked={prefs.showText} onCheckedChange={(showText) => onChange({ showText })} />
          </Row>
          <Row label="译文">
            <Select value={prefs.translation} onValueChange={(v) => onChange({ translation: v as TranslationMode })} disabled={!prefs.showText}>
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="current">当前句</SelectItem>
                <SelectItem value="off">不显示</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="聚焦当前句" htmlFor="cs-focus">
            <Switch id="cs-focus" checked={prefs.focusBlur} onCheckedChange={(focusBlur) => onChange({ focusBlur })} disabled={!prefs.showText} />
          </Row>
          <Row label="每句后暂停" htmlFor="cs-pause">
            <Switch id="cs-pause" checked={prefs.pauseEach} onCheckedChange={(pauseEach) => onChange({ pauseEach })} />
          </Row>
        </>
      )}
    </PopoverContent>
  </Popover>
);

const Row: React.FC<{ label: string; htmlFor?: string; children: React.ReactNode }> = ({ label, htmlFor, children }) => (
  <div className="flex items-center justify-between gap-3">
    <Label htmlFor={htmlFor} className="font-normal">
      {label}
    </Label>
    {children}
  </div>
);
