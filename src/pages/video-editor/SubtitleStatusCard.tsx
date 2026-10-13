import React, { useEffect, useState } from 'react';
import { AudioLines, Captions, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { jobPercent } from '@/components/Jobs';
import type { Job } from '@/types/job';

/** 识别任务每完成一部分就写进 detail：识别出几句、最后一句 */
type Heard = { lines?: number; last?: string };

/** 识别阶段（后端 ctx.stage）→ 标题 */
const STAGE_TITLE: Record<string, string> = {
  下载识别模型: '正在下载识别模型',
  准备音频: '正在准备音频',
  识别英文语音: '正在识别英文语音',
};

/** 剩余时间：只按「识别英文语音」这一阶段的速度估（下载、准备音频的速度不一样） */
function useRemaining(job: Job): string | null {
  const percent = jobPercent(job);
  const [start, setStart] = useState<{ stage: string | null; at: number; percent: number }>(() => ({ stage: job.stage, at: Date.now(), percent }));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (job.stage !== start.stage) setStart({ stage: job.stage, at: Date.now(), percent });
  }, [job.stage, start.stage, percent]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const done = percent - start.percent;
  if (job.stage !== '识别英文语音' || start.stage !== job.stage || done < 3 || now - start.at < 5000) return null;
  const seconds = (((now - start.at) / done) * (100 - percent)) / 1000;
  return seconds < 60 ? '不到 1 分钟' : `还要约 ${Math.ceil(seconds / 60)} 分钟`;
}

const RecognizingCard: React.FC<{ job: Job; onStop: () => void }> = ({ job, onStop }) => {
  const remaining = useRemaining(job);
  const heard = (job.detail ?? {}) as Heard;
  const percent = Math.floor(jobPercent(job));
  const title = job.status === 'queued' ? '等待识别字幕' : (STAGE_TITLE[job.stage ?? ''] ?? '正在识别字幕');
  const meta = [remaining, heard.lines ? `已识别 ${heard.lines} 句` : null].filter(Boolean).join(' · ');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <AudioLines className="size-5 motion-safe:animate-pulse" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{title}</div>
          {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
        </div>
        <span className="text-2xl font-semibold tabular-nums">{percent}%</span>
      </div>
      <Progress value={percent} className="h-1.5" aria-label="识别字幕进度" />
      {heard.last && <p className="line-clamp-2 text-sm text-muted-foreground italic">“{heard.last}”</p>}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onStop}>
          停止
        </Button>
      </div>
    </div>
  );
};

/**
 * 剪辑编辑器里字幕的状态（D61），浮在视频上方：正在识别时显示阶段、百分比、剩余时间、识别出的句子（可停止）；
 * 还没有字幕时给出「识别英文语音」与「选择字幕文件」。
 */
export const SubtitleStatusCard: React.FC<{
  job: Job | undefined;
  hasCues: boolean;
  onRecognize: () => void;
  onPickFile: () => void;
  onStop: (job: Job) => void;
}> = ({ job, hasCues, onRecognize, onPickFile, onStop }) => {
  if (!job && hasCues) return null;
  return (
    <div className="absolute top-4 left-1/2 z-10 w-[440px] max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl border bg-background/95 p-4 text-foreground shadow-lg backdrop-blur">
      {job ? (
        <RecognizingCard job={job} onStop={() => onStop(job)} />
      ) : (
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
            <Captions className="size-5" />
          </span>
          <div className="min-w-0 flex-1 font-medium">还没有字幕</div>
          <Button variant="outline" size="sm" onClick={onPickFile}>
            <FileText />
            选择字幕文件…
          </Button>
          <Button size="sm" onClick={onRecognize}>
            <AudioLines />
            识别英文语音
          </Button>
        </div>
      )}
    </div>
  );
};
