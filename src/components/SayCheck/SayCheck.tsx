import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, EyeOff, Loader2, Mic, Play, RotateCcw, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useRecorder } from '@/hooks/useRecorder';
import { usePronunciation } from '@/hooks/usePronunciation';
import type { PronunciationContext } from '@/types/pronunciation';
import { jobPercent } from '@/components/Jobs';
import { formatBytes } from '@/utils/fileSize';
import { BAND_LABEL, BAND_STYLE, bandOf, flaggedPhones, phoneSegments, phoneTip, type Band, type Strictness } from '@/utils/pronunciation';

/** 读过关后停多久再往下走（看清结果） */
const PASS_DELAY_MS = 1500;

export interface SayCheckResult {
  band: Band;
  score: number;
  /** 每个拼读块的标记（不准的音所在的块），给卡片上色 */
  segmentMarks: (Band | null)[];
}

export interface SayCheckProps {
  /** 卡片的「播放发音」按钮：和跟读按钮排在同一行 */
  play: React.ReactNode;
  /** 还没跟读时反馈行显示的提示（跟着读：th - ree） */
  hint: React.ReactNode;
  /** 要读的单词 */
  text: string;
  /** 自然拼读拆分（标出不准的音在哪一块） */
  segments: string[];
  strictness: Strictness;
  /** 小学生只看三档，其余也显示分数 */
  showScore: boolean;
  /** 暂停、离开这一步时为 true：停掉录音 */
  disabled?: boolean;
  onResult?: (result: SayCheckResult | null) => void;
  /** 学习计划里练习时带上：结果保存进计划的发音统计 */
  context?: PronunciationContext;
  /** 开始 / 结束录音（录音时页面不要放声音，免得录进去） */
  onRecordingChange?: (recording: boolean) => void;
  /**
   * row：一行按钮（播放发音 · 跟读 · 听我的）+ 一行反馈；
   * bar：卡片底部的跟读框（点框开麦，结果、再读、听我的都在框里），右边放 `trailing`
   */
  variant?: 'row' | 'bar';
  /** bar 时评估模型还没准备好，框右边放的按钮（盖住，开始写） */
  trailing?: React.ReactNode;
  /** bar 时不跟读、直接往下走（框里的小图标） */
  onSkip?: () => void;
  /** bar 时读过关（不是「再试试」）后自动调用：进入下一环节；学习者在这期间又点了框里的操作就不走 */
  onPass?: () => void;
}

/**
 * 看 · 说 的「说」：播完原音后自动开麦，读过关后自动进入下一环节（bar），学习者跟读一遍，本机评估后告诉他读得怎样、哪个音不准（对到拼读块上）。
 * 第一次使用先下载评估模型；录音与评估都在本机，不上传。读不好可以再读，最多自动开麦 3 次，不挡着往下走。
 * 录音带着这个词：录到一半换了词，录完的不评估。
 */
export const SayCheck: React.FC<SayCheckProps> = ({ play, hint, text, segments, strictness, showScore, disabled, onResult, context, onRecordingChange, variant = 'row', trailing, onSkip, onPass }) => {
  const recorder = useRecorder({ silenceStopMs: 700, maxMs: 4000 });
  const { ready, modelBytes, downloading: job, download, assessing, result, error, assess, reset } = usePronunciation(context);
  const player = useRef<HTMLAudioElement | null>(null);
  const [playingMine, setPlayingMine] = useState(false);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const onPassRef = useRef(variant === 'bar' ? onPass : undefined);
  onPassRef.current = variant === 'bar' ? onPass : undefined;
  const passTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPass = useCallback(() => {
    if (passTimer.current) clearTimeout(passTimer.current);
    passTimer.current = null;
  }, []);

  const stopMine = useCallback(() => {
    player.current?.pause();
    player.current = null;
    setPlayingMine(false);
  }, []);

  // 换词：停掉录音与回放，清掉上一个词的结果
  useEffect(() => {
    cancelPass();
    stopMine();
    recorder.stop();
    reset();
    recorder.clear();
    onResultRef.current?.(null);
  }, [text]);

  const start = useCallback(() => {
    if (!ready || disabled || recorder.state !== 'idle' || assessing) return;
    cancelPass();
    stopMine();
    void recorder.start(text);
  }, [ready, disabled, recorder, assessing, text, cancelPass, stopMine]);

  const recording = recorder.state !== 'idle';
  const onRecordingRef = useRef(onRecordingChange);
  onRecordingRef.current = onRecordingChange;
  useEffect(() => {
    onRecordingRef.current?.(recording);
  }, [recording]);

  useEffect(() => {
    if (!disabled) return;
    cancelPass();
    stopMine();
    if (recorder.state !== 'idle') recorder.stop();
  }, [disabled, recorder]);

  useEffect(() => () => {
    cancelPass();
    player.current?.pause();
  }, []);

  // 录完：本机评估，不准的音标在它的拼读块上（分低的标「再试试」色，只是有点像常见读偏的标「还差一点」色）
  const take = recorder.take;
  useEffect(() => {
    if (!take || take.tag !== text) return;
    void assess(take.url, text).then((r) => {
      if (!r || r.score === null) {
        onResultRef.current?.(null);
        return;
      }
      const word = r.words[0];
      const marks: (Band | null)[] = segments.map(() => null);
      if (word) {
        const where = phoneSegments(segments, word.phones.map((p) => p.ipa));
        for (const p of flaggedPhones(word, strictness)) {
          const seg = where[p.index];
          if (seg !== null && seg !== undefined) marks[seg] = p.score >= 60 ? (marks[seg] ?? 'close') : 'retry';
        }
      }
      const band = bandOf(r.score, strictness);
      onResultRef.current?.({ band, score: r.score, segmentMarks: marks });
      if (band !== 'retry' && onPassRef.current) {
        cancelPass();
        passTimer.current = setTimeout(() => {
          passTimer.current = null;
          onPassRef.current?.();
        }, PASS_DELAY_MS);
      }
    });
  }, [take]);

  /** 听我的：播放中再点是停止 */
  const toggleMine = () => {
    cancelPass();
    if (playingMine) {
      stopMine();
      return;
    }
    if (!take) return;
    player.current?.pause();
    const audio = new Audio(take.url);
    player.current = audio;
    const done = () => {
      if (player.current === audio) stopMine();
    };
    audio.onended = done;
    audio.onerror = done;
    setPlayingMine(true);
    void audio.play().catch(done);
  };

  const word = result?.words[0];
  const band = result?.score != null ? bandOf(result.score, strictness) : null;
  const tips = word && band ? flaggedPhones(word, strictness).map(phoneTip) : [];
  const problem = error ?? recorder.error;

  const scoreChip = band ? (
    <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-sm font-semibold', BAND_STYLE[band])}>
      {BAND_LABEL[band]}
      {showScore && result?.score != null ? ` · ${result.score}` : ''}
    </span>
  ) : null;

  if (variant === 'bar') {
    const iconAction = (label: string, icon: React.ReactNode, onClick: () => void) => (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={onClick} disabled={disabled || assessing} aria-label={label}>
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
    const bodyClass = 'flex h-full min-w-0 flex-1 items-center gap-3 text-left text-sm text-muted-foreground';
    let body: React.ReactNode;
    let extras: React.ReactNode = null;
    /** 框右边的大按钮：评估模型准备好时是「跟读」（录音时停止、读过后再读一遍），否则是页面给的（盖住，开始写） */
    let main: React.ReactNode = trailing;
    if (ready === null) {
      body = <span className={bodyClass}>{hint}</span>;
    } else if (!ready) {
      body = (
        <span className={bodyClass}>
          {job ? (
            <>
              正在下载评估模型
              <Progress value={jobPercent(job)} className="h-1.5 w-40" aria-label="下载进度" />
            </>
          ) : (
            (problem ?? (modelBytes ? `跟读评分需要先下载 ${formatBytes(modelBytes)}` : hint))
          )}
        </span>
      );
      extras = job ? null : (
        <Button variant="outline" size="sm" onClick={() => void download()}>
          <Download />
          下载
        </Button>
      );
    } else {
      if (recording) {
        body = (
          <span className={bodyClass}>
            <span className="flex h-5 items-end gap-0.5" aria-hidden>
              {recorder.live.slice(-24).map((v, i) => (
                <span key={i} className="w-0.5 rounded-full bg-primary" style={{ height: `${Math.max(2, v * 20)}px` }} />
              ))}
            </span>
            {recorder.state === 'arming' ? '准备…' : '在听…'}
          </span>
        );
      } else if (assessing) {
        body = (
          <span className={bodyClass}>
            <Loader2 className="size-5 shrink-0 animate-spin" />
            正在评分…
          </span>
        );
      } else if (band) {
        body = (
          <span className={cn(bodyClass, 'gap-x-3 overflow-hidden')}>
            {scoreChip}
            <span className="truncate">{tips.join('　')}</span>
          </span>
        );
      } else {
        body = (
          <span className={bodyClass}>
            <Mic className="size-5 shrink-0" />
            {problem ?? hint}
          </span>
        );
      }
      extras = (
        <>
          {take && !recording && iconAction('听我的', playingMine ? <Square className="fill-current" /> : <Play />, toggleMine)}
          {onSkip && !recording && iconAction('不读了，盖住开始写', <EyeOff />, () => {
            cancelPass();
            onSkip();
          })}
        </>
      );
      main = recording ? (
        <Button size="lg" variant="outline" className="h-14 px-6" onClick={recorder.stop}>
          <Square className="fill-current text-destructive" />
          停止
        </Button>
      ) : (
        <Button size="lg" className="h-14 px-6" onClick={start} disabled={disabled || assessing}>
          {band ? <RotateCcw /> : <Mic />}
          {band ? '再读一遍' : '跟读'}
        </Button>
      );
    }
    return (
      <TooltipProvider>
        <div className="flex items-center gap-3">
          <div
            className={cn('flex h-14 min-w-0 flex-1 items-center gap-1 rounded-xl border-2 bg-background pr-2 pl-3 transition-colors', recording && 'border-primary')}
            aria-live="polite"
          >
            {body}
            {extras}
          </div>
          {main}
        </div>
      </TooltipProvider>
    );
  }

  // 一行按钮（播放发音 · 跟读 · 听我的）+ 一行反馈（提示 / 正在听 / 结果）；反馈行占住高度，换状态时不跳
  let action: React.ReactNode;
  let feedback: React.ReactNode;
  if (ready === null) {
    action = null;
    feedback = hint;
  } else if (!ready) {
    action = job ? null : (
      <Button variant="outline" size="lg" onClick={() => void download()}>
        <Download />
        下载评估模型
      </Button>
    );
    feedback = job ? (
      <span className="flex items-center gap-2">
        正在下载评估模型
        <Progress value={jobPercent(job)} className="h-1.5 w-40" aria-label="下载进度" />
      </span>
    ) : (
      (problem ?? (modelBytes ? `跟读评分需要先下载 ${formatBytes(modelBytes)}` : null))
    );
  } else {
    action = recording ? (
      <Button variant="outline" size="lg" onClick={recorder.stop} aria-label="停止录音">
        <Square className="fill-current text-destructive" />
        {recorder.state === 'arming' ? '准备…' : '停止'}
        <span className="flex h-4 items-end gap-0.5" aria-hidden>
          {recorder.live.slice(-8).map((v, i) => (
            <span key={i} className="w-0.5 rounded-full bg-primary" style={{ height: `${Math.max(2, v * 16)}px` }} />
          ))}
        </span>
      </Button>
    ) : (
      <Button variant="outline" size="lg" onClick={start} disabled={disabled || assessing}>
        {assessing ? <Loader2 className="animate-spin" /> : band ? <RotateCcw /> : <Mic />}
        {band ? '再读一遍' : '跟读'}
      </Button>
    );
    feedback = recording ? (
      '在听…'
    ) : assessing ? (
      '正在评分…'
    ) : band ? (
      <span className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        {scoreChip}
        {tips.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </span>
    ) : (
      (problem ?? hint)
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div className="flex items-center gap-3">
        {play}
        {action}
        {ready && take && !recording && (
          <Button variant="outline" size="lg" onClick={toggleMine} disabled={assessing}>
            {playingMine ? <Square className="fill-current" /> : <Play />}
            听我的
          </Button>
        )}
      </div>
      <div className="flex min-h-7 items-center justify-center text-center text-sm text-muted-foreground" aria-live="polite">
        {feedback}
      </div>
    </div>
  );
};
