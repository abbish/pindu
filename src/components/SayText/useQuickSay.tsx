import React, { useEffect } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRecorder } from '@/hooks/useRecorder';
import { usePronunciation } from '@/hooks/usePronunciation';
import type { PronunciationContext } from '@/types/pronunciation';
import { SayText, SayVerdict } from './SayText';

/**
 * 随手「读一读」（单词卡、句子分析）：一个麦克风按钮，读完本机评估。
 * 返回按钮（`button`，设置里关掉时为 null）、按结果逐词标色的文字（`text`）与结果行（`verdict`：三档 + 怎么读 / 提示），由调用方摆放。
 * 模型还没下载时按钮点了先下载。
 */
export function useQuickSay(text: string, context?: PronunciationContext) {
  const recorder = useRecorder({ silenceStopMs: 900, maxMs: 15000 });
  const say = usePronunciation(context);

  useEffect(() => {
    say.reset();
    recorder.clear();
  }, [text]);

  const take = recorder.take;
  useEffect(() => {
    if (take) void say.assess(take.url, text);
  }, [take]);

  const recording = recorder.state !== 'idle';
  const button = !say.enabled ? null : say.ready === false ? (
    <Button variant="outline" size="icon" className="size-8" disabled={Boolean(say.downloading)} onClick={() => void say.download()} aria-label="读一读（先下载评估模型）" title="读一读（先下载评估模型，约 71MB）">
      {say.downloading ? <Loader2 className="animate-spin" /> : <Mic />}
    </Button>
  ) : (
    <Button
      variant={recording ? 'secondary' : 'outline'}
      size="icon"
      className="size-8"
      disabled={say.ready !== true || say.assessing}
      onClick={() => (recording ? recorder.stop() : void recorder.start())}
      aria-label={recording ? '读完了' : '读一读'}
      title={recording ? '读完了' : '读一读'}
    >
      {say.assessing ? <Loader2 className="animate-spin" /> : recording ? <Square className="text-destructive" /> : <Mic />}
    </Button>
  );

  const verdict: React.ReactNode = recording ? (
    <span className="text-sm text-muted-foreground">{recorder.heard ? '在听…' : '请读'}</span>
  ) : say.result ? (
    <SayVerdict result={say.result} strictness={say.strictness} showScore={say.showScore} />
  ) : say.downloading ? (
    <span className="text-sm text-muted-foreground">正在下载评估模型…</span>
  ) : (
    (say.error ?? recorder.error) && <span className="text-sm text-muted-foreground">{say.error ?? recorder.error}</span>
  );

  const marked = (className?: string) => <SayText text={text} result={recording ? null : say.result} strictness={say.strictness} className={className} />;

  return { button, verdict, marked };
}
