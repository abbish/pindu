import React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import type { Job } from '@/types/job';

export interface EditorBusyDialogProps {
  /** 正在跑的 AI 规划 / 切分任务；没有时不显示 */
  job: Job | undefined;
  onStop: (job: Job) => void;
  /** 离开编辑器，任务在后台继续 */
  onBackground: () => void;
}

const TITLE: Record<string, string> = {
  video_plan: 'AI 正在规划',
  video_process: '正在切分',
};

/**
 * AI 规划 / 切分进行中：模态进度，编辑器不可操作（任务结束会写入规划或按规划切分，中途编辑会不一致）。
 * 不能点外面关闭；可以停止，或转到后台离开编辑器，回来时任务还在跑就继续显示。
 */
export const EditorBusyDialog: React.FC<EditorBusyDialogProps> = ({ job, onStop, onBackground }) => {
  const percent = job && job.total > 0 ? Math.round((job.current / job.total) * 100) : null;
  return (
    <Dialog open={job !== undefined}>
      <DialogContent showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
        {job && (
          <>
            <DialogHeader>
              <DialogTitle>{TITLE[job.kind] ?? job.title}</DialogTitle>
              <DialogDescription className="flex items-center gap-2">
                <Loader2 className="size-4 shrink-0 animate-spin" />
                {job.status === 'queued' ? '排队中' : (job.stage ?? '处理中…')}
              </DialogDescription>
            </DialogHeader>
            {percent !== null && (
              <div className="flex items-center gap-3">
                <Progress value={percent} className="flex-1" />
                <span className="w-16 text-right text-sm text-muted-foreground tabular-nums">
                  {job.current} / {job.total}
                </span>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onStop(job)}>
                停止
              </Button>
              <Button onClick={onBackground}>后台运行</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
