import React from 'react';
import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { type PracticeSession } from '@/types/study';
import { lastActiveLabel, practiceProgress, sortByLastActive } from '@/utils/incompletePractice';

export interface ContinuePracticeBannerProps {
  /** 未完成的练习（为空时不显示） */
  sessions: PracticeSession[];
  /** 继续某次练习 */
  onContinue: (session: PracticeSession) => void;
  /** 查看全部未完成练习（打开提醒弹框） */
  onShowAll: () => void;
}

/**
 * 首页「继续上次练习」条：启动提醒弹框关掉之后，首页仍有一个轻量入口。
 * 显示最近练过的那次练习的进度；有多次时可以展开查看全部。
 */
export const ContinuePracticeBanner: React.FC<ContinuePracticeBannerProps> = ({ sessions, onContinue, onShowAll }) => {
  if (sessions.length === 0) return null;
  const latest = sortByLastActive(sessions)[0];
  const progress = practiceProgress(latest);
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const more = sessions.length - 1;

  return (
    <section
      aria-label="继续上次练习"
      className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3"
    >
      <History className="size-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium">继续上次的练习</span>
          <span className="truncate text-muted-foreground">
            {latest.planTitle || `学习计划 #${latest.planId}`} ·{' '}
            {progress.done > 0 ? `已完成 ${progress.done} / ${progress.total} 题` : `还没作答 · 共 ${progress.total} 题`} ·{' '}
            {lastActiveLabel(latest.updatedAt || latest.startTime)}练过
          </span>
        </div>
        {progress.done > 0 && <Progress value={percent} className="h-1 max-w-sm" aria-label={`已完成 ${percent}%`} />}
      </div>
      {more > 0 && (
        <Button variant="link" size="sm" className="shrink-0 text-muted-foreground" onClick={onShowAll}>
          还有 {more} 次未完成
        </Button>
      )}
      <Button size="sm" className="shrink-0" onClick={() => onContinue(latest)}>
        继续练习
      </Button>
    </section>
  );
};
