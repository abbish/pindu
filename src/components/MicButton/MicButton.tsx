import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useJob } from '@/hooks/useJobs';
import { useRecorder } from '@/hooks/useRecorder';
import { dictationService } from '@/services/dictationService';
import { jobPercent } from '@/components/Jobs';
import { recordingToPcmBase64 } from '@/utils/audioPcm';
import { formatBytes } from '@/utils/fileSize';
import type { DictationLanguage, DictationStatus } from '@/types/pronunciation';

/** 识别模型是否就绪在页面间共用 */
let cachedReady: boolean | null = null;

export interface MicButtonProps {
  /** 说完、转成文字后（转文字要一两秒，调用方按那时最新的内容拼接） */
  onText: (text: string) => void;
  /** 开始 / 结束说话（调用方可以暂停别的声音） */
  onRecordingChange?: (recording: boolean) => void;
  disabled?: boolean;
  className?: string;
  /** 按钮旁的提示（默认「说话输入」） */
  label?: string;
  /** zh 中文为主（夹着英文单词也认）/ en 英文 */
  language: DictationLanguage;
}

/**
 * 说话代替打字：点一下开始说，停顿一会儿自动结束（也可以再点结束），在本机转成文字交给 `onText`。
 * 第一次用先下载语音输入模型（设置 → 本机模型里也能管理）。
 */
export const MicButton: React.FC<MicButtonProps> = ({ onText, onRecordingChange, disabled, className, label = '说话输入', language }) => {
  const recorder = useRecorder({ silenceStopMs: 1800, maxMs: 60000 });
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const [status, setStatus] = useState<DictationStatus | null>(null);
  const [ready, setReady] = useState<boolean | null>(cachedReady);
  const [job, setJob] = useState<string | null>(null);
  const downloading = useJob(job);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void dictationService.status().then((r) => {
      if (!r.success) {
        setReady(false);
        setError(r.error);
        return;
      }
      setStatus(r.data);
      cachedReady = r.data.ready;
      setReady(r.data.ready);
      if (r.data.downloadJob) setJob(r.data.downloadJob);
    });
  }, []);
  useEffect(() => {
    if (downloading?.status === 'succeeded') {
      cachedReady = true;
      setReady(true);
      setJob(null);
    } else if (downloading?.status === 'failed') {
      setError('语音输入模型没有下载成功，请检查网络后再试');
      setJob(null);
    }
  }, [downloading?.status]);

  // 出错提示停留几秒
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const recording = recorder.state !== 'idle';
  useEffect(() => {
    onRecordingChange?.(recording);
  }, [recording]);

  const take = recorder.take;
  useEffect(() => {
    if (!take) return;
    recorder.close();
    let stale = false;
    setBusy(true);
    void (async () => {
      try {
        const r = await dictationService.transcribe(await recordingToPcmBase64(take.url), language);
        if (stale) return;
        if (!r.success) {
          if (r.code === 'NOT_FOUND') {
            cachedReady = false;
            setReady(false);
          }
          setError(r.error);
        } else if (r.data) onTextRef.current(r.data);
        else setError('没有听到声音');
      } catch {
        if (!stale) setError('录音读不出来，再说一遍');
      } finally {
        if (!stale) setBusy(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [take]);

  const click = async () => {
    setError(null);
    if (recording) return recorder.stop();
    if (ready === false) {
      const r = await dictationService.startDownload();
      if (r.success) setJob(r.data);
      else setError(r.error);
      return;
    }
    void recorder.start();
  };

  const tip = error
    ? error
    : downloading
      ? `正在下载语音输入模型 ${Math.floor(jobPercent(downloading))}%`
      : ready === false
        ? `${label}（先下载语音输入模型 ${formatBytes(status?.modelBytes ?? 0)}）`
        : recording
          ? '在听，说完会自动停'
          : busy
            ? '正在转文字…'
            : label;

  return (
    <Tooltip open={error || recording || downloading ? true : undefined}>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={recording ? 'secondary' : 'ghost'}
          size="icon"
          className={cn('size-8', className)}
          disabled={disabled || busy || Boolean(downloading) || ready === null}
          onClick={() => void click()}
          aria-label={recording ? '说完了' : label}
        >
          {busy || downloading ? <Loader2 className="animate-spin" /> : recording ? <Square className="text-destructive" /> : <Mic />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
};
