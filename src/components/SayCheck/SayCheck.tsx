import React, { useCallback, useEffect, useRef } from 'react';
import { Download, Loader2, Mic, Play, RotateCcw, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useRecorder } from '@/hooks/useRecorder';
import { usePronunciation } from '@/hooks/usePronunciation';
import type { PronunciationContext } from '@/types/pronunciation';
import { jobPercent } from '@/components/Jobs';
import { formatBytes } from '@/utils/fileSize';
import { BAND_LABEL, BAND_STYLE, bandOf, flaggedPhones, phoneSegments, phoneTip, type Band, type Strictness } from '@/utils/pronunciation';

/** 一个词最多自动开麦几次（之后不再自动，学习者可以自己点） */
const MAX_AUTO_TRIES = 3;

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
  /** 变化时（且不为空）自动开始录音：播完单词原音后由页面给 */
  autoStartKey: string | null;
  /** 暂停、离开这一步时为 true：停掉录音 */
  disabled?: boolean;
  onResult?: (result: SayCheckResult | null) => void;
  /** 学习计划里练习时带上：结果保存进计划的发音统计 */
  context?: PronunciationContext;
  /** 开始 / 结束录音（录音时页面不要放声音，免得录进去） */
  onRecordingChange?: (recording: boolean) => void;
}

/**
 * 看 · 说 的「说」：播完原音后自动开麦，学习者跟读一遍，本机评估后告诉他读得怎样、哪个音不准（对到拼读块上）。
 * 第一次使用先下载评估模型；录音与评估都在本机，不上传。读不好可以再读，最多自动开麦 3 次，不挡着往下走。
 * 录音带着这个词：录到一半换了词，录完的不评估。
 */
export const SayCheck: React.FC<SayCheckProps> = ({ play, hint, text, segments, strictness, showScore, autoStartKey, disabled, onResult, context, onRecordingChange }) => {
  const recorder = useRecorder({ silenceStopMs: 700, maxMs: 4000 });
  const { ready, modelBytes, downloading: job, download, assessing, result, error, assess, reset } = usePronunciation(context);
  const tries = useRef(0);
  /** 挂载时已有的开麦信号不算（离开看 · 说再回来时那是上一个词的） */
  const seenKey = useRef(autoStartKey);
  const player = useRef<HTMLAudioElement | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  // 换词：停掉录音，清掉上一个词的结果
  useEffect(() => {
    tries.current = 0;
    recorder.stop();
    reset();
    recorder.clear();
    onResultRef.current?.(null);
  }, [text]);

  const start = useCallback(() => {
    if (!ready || disabled || recorder.state !== 'idle' || assessing) return;
    void recorder.start(text);
  }, [ready, disabled, recorder, assessing, text]);

  // 播完原音后自动开麦（每个词最多几次）
  useEffect(() => {
    if (!autoStartKey || autoStartKey === seenKey.current) return;
    seenKey.current = autoStartKey;
    if (!ready || disabled || tries.current >= MAX_AUTO_TRIES) return;
    tries.current += 1;
    start();
  }, [autoStartKey, ready]);

  const recording = recorder.state !== 'idle';
  const onRecordingRef = useRef(onRecordingChange);
  onRecordingRef.current = onRecordingChange;
  useEffect(() => {
    onRecordingRef.current?.(recording);
  }, [recording]);

  useEffect(() => {
    if (disabled && recorder.state !== 'idle') recorder.stop();
  }, [disabled, recorder]);

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
      onResultRef.current?.({ band: bandOf(r.score, strictness), score: r.score, segmentMarks: marks });
    });
  }, [take]);

  const playMine = () => {
    if (!take) return;
    player.current?.pause();
    player.current = new Audio(take.url);
    void player.current.play();
  };

  const word = result?.words[0];
  const band = result?.score != null ? bandOf(result.score, strictness) : null;
  const tips = word && band ? flaggedPhones(word, strictness).map(phoneTip) : [];
  const problem = error ?? recorder.error;

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
        <Square className="text-destructive" />
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
        <span className={cn('rounded-full px-2.5 py-0.5 text-sm font-semibold', BAND_STYLE[band])}>
          {BAND_LABEL[band]}
          {showScore && result?.score != null ? ` · ${result.score}` : ''}
        </span>
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
          <Button variant="outline" size="lg" onClick={playMine} disabled={assessing}>
            <Play />
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
