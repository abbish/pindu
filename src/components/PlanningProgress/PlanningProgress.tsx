import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { wordBookService } from '@/services/wordbookService';
import type { PlanningProgressState } from '@/types';

export interface PlanningProgressProps {
  /** 是否在规划中（显示并开始轮询） */
  isVisible: boolean;
  /** 取消规划 */
  onCancel: () => void;
}

/**
 * AI 规划学习计划的进度（内联卡片，不再遮住整个窗口）：
 * 轮询 get_analysis_progress（1s 起，有输出后 0.8s，失败退避到 5s）；当前步骤、已接收块数、字符数、用时；可取消。
 */
export const PlanningProgress: React.FC<PlanningProgressProps> = ({ isVisible, onCancel }) => {
  const [progress, setProgress] = useState<PlanningProgressState | null>(null);

  useEffect(() => {
    if (!isVisible) {
      setProgress(null);
      return;
    }
    let stopped = false;
    let timer: number | undefined;
    let interval = 1000;
    let misses = 0;
    const poll = async () => {
      const result = await wordBookService.getAnalysisProgress();
      if (stopped) return;
      if (result.success && result.data) {
        setProgress(result.data);
        misses = 0;
        if (['completed', 'error', 'cancelled'].includes(result.data.status)) return;
        interval = result.data.chunks_received > 0 ? 800 : 1200;
      } else {
        misses++;
        if (misses >= 3) return;
        interval = Math.min(interval * 1.5, 5000);
      }
      timer = window.setTimeout(poll, interval);
    };
    poll();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [isVisible]);

  if (!isVisible) return null;

  const status = progress?.status;
  const done = status === 'completed';
  const failed = status === 'error';
  // 规划输出长度不可预知：按收到的块数做一个渐近的进度感，完成时 100%
  const pct = done ? 100 : progress?.chunks_received ? Math.min(90, 15 + progress.chunks_received * 2) : 8;

  return (
    <div className="space-y-2.5 rounded-lg border p-3" role="status">
      <div className="flex items-center gap-2.5">
        {done ? (
          <CheckCircle2 className="size-4 shrink-0 text-success" />
        ) : failed ? (
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
        ) : (
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{done ? '排序完成' : failed ? '排序失败' : 'AI 正在排学习顺序'}</div>
          <div className="truncate text-xs text-muted-foreground">
            {progress?.current_step ?? '准备中…'}
            {progress && ` · 已用 ${Math.round(progress.elapsed_seconds)} 秒`}
          </div>
        </div>
        {!done && (
          <Button variant="ghost" size="sm" className="h-7" onClick={onCancel}>
            取消
          </Button>
        )}
      </div>
      <Progress value={pct} className="h-1 [&>[data-slot=progress-indicator]]:bg-brand" />
      {progress && progress.elapsed_seconds > 60 && !done && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="size-3.5" />
          单词较多时需要 1–3 分钟，请耐心等待。
        </p>
      )}
      {progress?.error_message && <p className="text-xs text-destructive">{progress.error_message}</p>}
    </div>
  );
};
