import React, { useEffect, useRef, useState } from 'react';
import { AudioLines, Captions, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { jobPercent } from '@/components/Jobs';
import type { Job } from '@/types/job';

/** 识别任务每完成一部分就写进 detail：识别出几句、最后一句 */
type Heard = { lines?: number; last?: string };

/** 剩余时间：只按「识别英文语音」这一阶段的速度估（下载、准备音频的速度不一样） */
function useRemaining(job: Job): string | null {
  const [now, setNow] = useState(() => Date.now());
  const start = useRef<{ stage: string | null; at: number; percent: number } | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const percent = Math.floor(jobPercent(job));
  if (start.current?.stage !== job.stage) start.current = { stage: job.stage, at: Date.now(), percent };
  const s = start.current;
  const done = percent - s.percent;
  if (job.stage !== '识别英文语音' || done < 3 || now - s.at < 5000) return null;
  const seconds = ((now - s.at) / done) * (100 - percent) / 1000;
  if (seconds < 60) return '不到 1 分钟';
  return `大约还要 ${Math.ceil(seconds / 60)} 分钟`;
}

const STAGE_TITLE: Record<string, string> = {
  '下载语音识别模型（只需一次）': '正在下载识别模型（只需一次）',
  准备音频: '正在准备音频',
  识别英文语音: '正在识别英文语音',
};

const RecognizingCard: React.FC<{ job: Job; replacing: boolean; onStop: () => void }> = ({ job, replacing, onStop }) => {
  const remaining = useRemaining(job);
  const heard = (job.detail ?? {}) as Heard;
  const percent = Math.floor(jobPercent(job));
  const title = job.status === 'queued' ? '等待识别字幕（视频还在导入）' : (STAGE_TITLE[job.stage ?? ''] ?? '正在识别字幕');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <AudioLines className="size-5 motion-safe:animate-pulse" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">
            {[remaining, heard.lines ? `已识别 ${heard.lines} 句` : null].filter(Boolean).join(' · ') || (replacing ? '识别完会换掉现在的字幕' : '识别完就可以规划和切分')}
          </div>
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
 * 剪辑编辑器里字幕的状态（D61），浮在视频上方，不仔细看也注意得到：
 * 正在识别时显示阶段、百分比、剩余时间、识别出的句子（可停止）；还没有字幕时给出「识别英文语音」与「选择字幕文件」。
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
        <RecognizingCard job={job} replacing={hasCues} onStop={() => onStop(job)} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning">
              <Captions className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="font-medium">这个视频还没有字幕</div>
              <div className="text-xs text-muted-foreground">在本机识别英文语音，或选择字幕文件。影视剧建议用正式字幕</div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onPickFile}>
              <FileText />
              选择字幕文件…
            </Button>
            <Button size="sm" onClick={onRecognize}>
              <AudioLines />
              识别英文语音
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
