import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Ear, Eye, Languages, Mic, Pause, Play, Settings2 } from 'lucide-react';
import { IconToggle } from '@/components/IconToggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
import { useClipTimes } from '@/hooks/useClipTimes';
import { canAddTarget, formsOf } from '@/utils/passage';
import { useTargetWordInfo } from './useTargetWordInfo';
import { cn } from '@/lib/utils';
import { SentenceAnalysisPanel } from '@/components/SentenceAnalysis';
import type { Passage, PassageSentence } from '@/types/passage';
import type { PassageVideo } from '@/types/video';
import { ListenBuildPanel } from './ListenBuildPanel';
import type { PronunciationContext } from '@/types/pronunciation';
import { useSentenceSay } from '@/components/SayText';

/** 观看 / 跟读 / 听力 */
type Mode = 'watch' | 'shadow' | 'listen';
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
  /** 译文打开时显示哪些：当前句 / 全部（关掉再打开时沿用） */
  translationMode: 'current' | 'all';
  /** 聚焦：当前句放大，上下文渐隐 */
  focusBlur: boolean;
  /** 观看：每句播完自动暂停 */
  pauseEach: boolean;
  /** 跟读：每句原声播几遍再跟读 */
  shadowRepeat: number;
}

const PREFS_KEY = 'passage.clipStudy.v1';
const DEFAULT_PREFS: ClipPrefs = { subtitles: 'both', showText: true, translation: 'all', translationMode: 'all', focusBlur: true, pauseEach: false, shadowRepeat: 1 };

function loadPrefs(): ClipPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const saved = { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<ClipPrefs>) };
    // 以前只有 translation：开着时它就是显示方式
    if (!(JSON.parse(raw) as Partial<ClipPrefs>).translationMode && saved.translation !== 'off') saved.translationMode = saved.translation;
    return saved;
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
  onAddTarget?: (word: string, stay?: boolean, form?: string) => void;
  /** 打开这个目标词的完整单词卡 */
  onOpenWord?: (word: string) => void;
  /** 句子分析里改译文；失败时返回原因 */
  onEditTranslation?: (index: number, zh: string) => Promise<string | null>;
  /** 有阅读理解题时「做听力题」 */
  onPractice?: () => void;
  /** 学习计划里跟读时带上：发音结果保存进计划的统计 */
  pronunciationContext?: PronunciationContext;
}

/** 句子在短片里的时间（没有时间的句子按 0） */
const startOf = (s: PassageSentence | undefined) => s?.startMs ?? 0;
const endOf = (s: PassageSentence | undefined) => s?.endMs ?? startOf(s);

/** 单句播放提前一点停：暂停生效要一小会儿，不提前会漏出下一句的开头 */
const STOP_LEAD_MS = 40;

/** 跟读里两步之间稍停一下（看清结果、换气） */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 视频短片的学习面板：
 * - 观看：视频 + 右侧台词（与朗读一样：当前句放大、上下文渐隐、重点词标出），点台词跳过去；可每句后暂停；每句后面可以跟读这一句；
 * - 跟读：和原文的「读完一句自动跟读」一样，只是原声来自视频：播这一句（可播几遍）→ 自动开麦跟读 → 本机评分，
 *   结果留在这句下面（可听自己的录音），接着下一句；点台词从那句开始；
 * - 听力：每句只听不看，用单词卡拼出听到的句子，拼对后画面才显示这句字幕（见 ListenBuildPanel）。
 * 「练习设置」里调画面字幕、台词显示、翻译、聚焦、自动暂停与原声遍数。
 */

export const ClipStudyPanel: React.FC<ClipStudyPanelProps> = ({ video, sentences: rawSentences, passage, onAddTarget, onOpenWord, onEditTranslation, onPractice, pronunciationContext }) => {
  // 句子起止按声音校准（字幕交界常常紧挨着下一句开口，单句播放会带出下一句的开头），波形读不到时用字幕时间
  const sentences = useClipTimes(video, rawSentences);
  const targetWords = useMemo(() => passage.targetWords.map((w) => w.word), [passage.targetWords]);
  /** 目标词组在台词里的写法 */
  const forms = useMemo(() => formsOf(passage.targetWords), [passage.targetWords]);
  // 台词每句后面的跟读：开始前暂停视频
  const texts = useMemo(() => rawSentences.map((s) => s.en), [rawSentences]);
  const sentenceSay = useSentenceSay(texts, pronunciationContext, () => videoRef.current?.pause());
  const say = sentenceSay.say;
  /** 正在看分析的台词 */
  const [analyzing, setAnalyzing] = useState<number | null>(null);
  const wordInfo = useTargetWordInfo(passage);
  const wordAudio = useAudioPlayer();
  const videoRef = useRef<HTMLVideoElement>(null);
  const textBox = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('watch');
  const [prefs, setPrefs] = useState<ClipPrefs>(loadPrefs);
  // 听句拼句、隐藏台词时不看句子分析（分析里有整句台词）
  useEffect(() => {
    if (mode === 'listen' || (mode === 'watch' && !prefs.showText)) setAnalyzing(null);
  }, [mode, prefs.showText]);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [current, setCurrent] = useState(0);
  /** 听力里拼好的句子：画面上可以显示它的字幕 */
  const [solved, setSolved] = useState<Set<number>>(new Set());
  /** 跟读：正在自动一句一句跟读；flowToken 每次开始 / 停下加 1，旧流程据此退出 */
  const [flowing, setFlowing] = useState(false);
  const flowToken = useRef(0);
  /** 单句原声播完（true）或被打断（false）时通知等着的跟读流程 */
  const originalDone = useRef<((finished: boolean) => void) | null>(null);
  /** 播到这里自动停（单句播放 / 每句后暂停） */
  const stopAt = useRef<number | null>(null);
  /** 这次播放是单句原声（跟读、听力用） */
  const sentencePlay = useRef(false);
  /** 单句播放是不是慢速（听句拼句的「再听」「慢速」按钮据此显示哪个在播） */
  const [sentenceSlow, setSentenceSlow] = useState(false);
  /** 每句后暂停：正在播的那句（播过它的结尾就停）；播放中改开关也立刻生效 */
  const pauseEachRef = useRef(false);
  pauseEachRef.current = mode === 'watch' && prefs.pauseEach;
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
  // 听力：没拼好的句子不显示字幕；跟读 / 观看按设置
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
          stopAt.current = null;
          v.pause();
          v.currentTime = end / 1000;
          v.playbackRate = rate;
          if (sentencePlay.current) {
            const done = originalDone.current;
            originalDone.current = null;
            done?.(true);
          }
          sentencePlay.current = false;
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
  }, [playing, mode, current, sentences, rate]);

  const seek = (ms: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = ms / 1000;
    playingSentence.current = null;
    setNow(ms);
  };

  /** 只播一句（跟读原声、听力）；slow 时这一句用慢速。播完返回 true，被打断返回 false */
  const playSentence = useCallback(
    (index: number, slow = false) =>
      new Promise<boolean>((resolve) => {
      const s = sentences[index];
      const v = videoRef.current;
      if (!s || !v) return resolve(false);
      originalDone.current?.(false);
      originalDone.current = resolve;
      setCurrent(index);
      v.currentTime = startOf(s) / 1000;
      v.playbackRate = slow ? SLOW_RATE : rate;
      setSentenceSlow(slow);
      stopAt.current = Math.max(startOf(s), endOf(s) - STOP_LEAD_MS);
      sentencePlay.current = true;
      void v.play();
      }),
    [sentences, rate]
  );

  const pause = () => {
    videoRef.current?.pause();
    stopAt.current = null;
    sentencePlay.current = false;
    const done = originalDone.current;
    originalDone.current = null;
    done?.(false);
  };

  /** 停下跟读流程（录到一半的照常收尾、评分） */
  const stopFlow = () => {
    flowToken.current += 1;
    setFlowing(false);
    sentenceSay.stop();
    pause();
  };

  /** 跟读：从第 from 句开始，播原声（设定的遍数）→ 跟读 → 评分，一句接一句；麦克风打不开时停下，原因写在那句下面 */
  const runFlow = async (from: number) => {
    const token = ++flowToken.current;
    const alive = () => token === flowToken.current;
    sentenceSay.stop();
    setFlowing(true);
    if (from === 0) sentenceSay.clear();
    for (let i = from; i < sentences.length; i++) {
      setCurrent(i);
      for (let r = 0; r < prefs.shadowRepeat; r++) {
        if (r > 0) await sleep(400);
        if (!alive() || !(await playSentence(i)) || !alive()) return;
      }
      const outcome = await sentenceSay.run(i);
      if (!alive()) return;
      if (outcome === 'mic') break;
      await sleep(outcome === 'scored' ? 1200 : 500);
      if (!alive()) return;
    }
    setFlowing(false);
  };

  // 离开页面：跟读流程不再往下走
  useEffect(() => () => void (flowToken.current += 1), []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (mode === 'shadow') return flowing ? stopFlow() : void runFlow(current);
    if (!v.paused) return pause();
    // 句子后面的跟读还在录：先停（不然原声会被录进去）
    sentenceSay.stop();
    if (mode === 'listen') return void playSentence(current);
    // 观看：每句后暂停由播放头跟踪（见上面的 tick）
    stopAt.current = null;
    playingSentence.current = null;
    sentencePlay.current = false;
    void v.play();
  };

  const changeMode = (next: Mode) => {
    if (flowing) stopFlow();
    pause();
    setMode(next);
    if (next === 'shadow' || next === 'listen') {
      const i = next === 'listen' ? 0 : Math.max(0, active);
      setCurrent(i);
      seek(startOf(sentences[i]));
    }
    if (next === 'listen') setSolved(new Set());
  };

  /** 跟读进行到哪一步 */
  const flowStatus = !flowing ? '' : sentenceSay.recording ? '请跟读' : say.assessing ? '正在评分…' : `第 ${current + 1}/${sentences.length} 句`;
  /** 右侧台词当前句：跟读时是正在练的那句 */
  const readerCurrent = mode === 'shadow' ? (flowing ? current : active >= 0 ? active : current) : active >= 0 ? active : null;

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
            if (flowing) stopFlow();
            seek(ms);
            if (mode !== 'watch') {
              stopAt.current = null;
              sentencePlay.current = false;
              const i = sentences.findIndex((x) => startOf(x) <= ms && ms < endOf(x));
              if (mode === 'shadow' && i >= 0) setCurrent(i);
            }
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup type="single" value={mode} onValueChange={(v) => v && changeMode(v as Mode)} variant="outline">
            <ToggleGroupItem value="watch" className="px-3">
              <Eye />
              观看
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
            {flowStatus && (
              <span className="mr-1 text-sm text-muted-foreground" aria-live="polite">
                {flowStatus}
              </span>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={togglePlay} aria-label={mode === 'shadow' ? (flowing ? '停止跟读' : '开始跟读') : playing ? '暂停' : '播放'}>
                  {(mode === 'shadow' ? flowing : playing) ? <Pause /> : <Play />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{mode === 'shadow' ? (flowing ? '停止跟读' : '开始跟读') : playing ? '暂停' : '播放'}</TooltipContent>
            </Tooltip>
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
            {/* 译文常开常关，放在外面；其余设一次就不动的在 ⚙ 里 */}
            {mode !== 'listen' && (
              <IconToggle
                label="译文"
                pressed={prefs.translation !== 'off'}
                onPressedChange={(on) => updatePrefs({ translation: on ? prefs.translationMode : 'off' })}
                disabled={mode === 'watch' && !prefs.showText}
              >
                <Languages />
              </IconToggle>
            )}
            {mode !== 'listen' && <PrefsPopover mode={mode} prefs={prefs} onChange={updatePrefs} />}
          </div>
        </div>
      </div>

      {/* 右侧与左侧（视频 + 时间轴 + 控制栏）同高，内容多时在里面滚动 */}
      <div className="relative min-h-[360px]">
      <Card className="absolute inset-0 flex flex-col gap-0 overflow-hidden p-0">
        {mode !== 'listen' && (
          <div ref={textBox} className="min-h-0 flex-1 overflow-y-auto p-3">
            {mode === 'shadow' && say.enabled && say.ready === false && <ModelNotice downloading={Boolean(say.downloading)} onDownload={() => void say.download()} />}
            <SelectionAction
              label="加入词汇"
              accept={(text) => Boolean(onAddTarget) && canAddTarget(text, targetWords)}
              onAction={(text) => onAddTarget?.(text)}
            >
            <PassageReader
              onAnalyzeSentence={setAnalyzing}
              sentenceAction={sentenceSay.action}
              below={sentenceSay.below}
              analyzing={analyzing}
              scrollContainer={textBox}
              sentences={sentences}
              current={readerCurrent}
              translation={prefs.translation}
              highlight={targetWords}
              highlightForms={forms}
              focusBlur={prefs.focusBlur}
              hidden={mode === 'watch' && !prefs.showText}
              playState={mode === 'shadow' ? (flowing ? { index: current, playing: true } : null) : active >= 0 ? { index: active, playing } : null}
              onPlaySentence={(i) => {
                // 跟读：从这句开始（正在跟读这句时是停下）
                if (mode === 'shadow') {
                  if (flowing && current === i) return stopFlow();
                  return void runFlow(i);
                }
                // 正在播这句：暂停
                if (playing && active === i) return pause();
                sentenceSay.stop();
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
                  speak={(w, slow) => wordAudio.speak(w, { slow, before: () => videoRef.current?.pause() })}
                  onOpenCard={onOpenWord ? () => onOpenWord(target) : undefined}
                />
              )}
            />
            </SelectionAction>
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
            onPlay={(i, slow) => void playSentence(i, slow)}
            onStop={pause}
            playing={playing ? (sentenceSlow ? 'slow' : 'normal') : null}
            onSolved={(i) => setSolved((s) => new Set(s).add(i))}
            onPractice={onPractice}
          />
          </div>
        )}
      </Card>
      </div>
      {analyzing !== null && (
        <SentenceAnalysisPanel passageId={passage.id} sentences={sentences} index={analyzing} onIndexChange={setAnalyzing} targets={targetWords} onAddTarget={onAddTarget && ((w, form) => onAddTarget(w, true, form))} onEditTranslation={onEditTranslation} onClose={() => setAnalyzing(null)} />
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

/** 练习设置：画面字幕；观看另有台词显示、每句后暂停；观看与跟读有译文显示、聚焦；跟读有原声遍数 */
const PrefsPopover: React.FC<{ mode: Mode; prefs: ClipPrefs; onChange: (patch: Partial<ClipPrefs>) => void }> = ({ mode, prefs, onChange }) => (
  <Popover>
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label="练习设置">
            <Settings2 />
          </Button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent>练习设置</TooltipContent>
    </Tooltip>
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
      {mode === 'watch' && (
        <Row label="显示台词列表" htmlFor="cs-text">
          <Switch id="cs-text" checked={prefs.showText} onCheckedChange={(showText) => onChange({ showText })} />
        </Row>
      )}
      {mode === 'shadow' && (
        <Row label="每句原声播放">
          <Select value={String(prefs.shadowRepeat)} onValueChange={(v) => onChange({ shadowRepeat: Number(v) })}>
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} 遍
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      )}
      {mode !== 'listen' && (
        <>
          <Row label="译文显示">
            <Select
              value={prefs.translationMode}
              onValueChange={(v) => {
                const mode = v as ClipPrefs['translationMode'];
                onChange({ translationMode: mode, translation: prefs.translation === 'off' ? 'off' : mode });
              }}
              disabled={mode === 'watch' && !prefs.showText}
            >
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="current">当前句</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="聚焦当前句" htmlFor="cs-focus">
            <Switch id="cs-focus" checked={prefs.focusBlur} onCheckedChange={(focusBlur) => onChange({ focusBlur })} disabled={mode === 'watch' && !prefs.showText} />
          </Row>
        </>
      )}
      {mode === 'watch' && (
        <Row label="每句后暂停" htmlFor="cs-pause">
          <Switch id="cs-pause" checked={prefs.pauseEach} onCheckedChange={(pauseEach) => onChange({ pauseEach })} />
        </Row>
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

/** 跟读要先下载评估模型（没下载时也能跟读、听自己的录音，只是没有评分） */
const ModelNotice: React.FC<{ downloading: boolean; onDownload: () => void }> = ({ downloading, onDownload }) => (
  <div className="mb-3 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
    <span className="min-w-0 flex-1">{downloading ? '正在下载评估模型…' : '跟读评分要先下载评估模型'}</span>
    {!downloading && (
      <Button variant="outline" size="sm" className="h-7" onClick={onDownload}>
        <Download />
        下载
      </Button>
    )}
  </div>
);
