import React from 'react';
import { ArrowRight, Check, Clock, Home, Minus, PauseCircle, RotateCw, Target, TriangleAlert, Trophy, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MetricCard } from '@/components/MetricCard/MetricCard';
import { cn } from '@/lib/utils';
import { formatDuration, nowInstant } from '@/utils/datetime';
import { checkpointTitle, wordCheckpoints, type CheckpointStatus } from '@/utils/practiceCheckpoints';
import type { PracticeResult, WordPracticeState } from '@/types/study';
import type { NavigateFn } from '@/navigation';

export interface PracticeResultPageProps {
  /** 练习结果数据 */
  result?: PracticeResult;
  /** Navigation handler */
  onNavigate?: NavigateFn;
}

const EMPTY_RESULT: PracticeResult = {
  sessionId: 'unknown',
  planId: 0,
  scheduleId: 0,
  scheduleDate: '',
  totalWords: 0,
  passedWords: 0,
  totalSteps: 0,
  correctSteps: 0,
  stepAccuracy: 0,
  wordAccuracy: 0,
  totalTime: 0,
  activeTime: 0,
  pauseCount: 0,
  averageTimePerWord: 0,
  difficultWords: [],
  passedWordsList: [],
  completedAt: nowInstant(),
};

const STATUS_META: Record<CheckpointStatus, { icon: React.ComponentType<{ className?: string }>; className: string }> = {
  first: { icon: Check, className: 'bg-success-soft text-success' },
  fixed: { icon: RotateCw, className: 'bg-warning-soft text-warning' },
  missed: { icon: X, className: 'bg-destructive/10 text-destructive' },
  none: { icon: Minus, className: 'bg-muted text-muted-foreground' },
};

function grade(accuracy: number): { level: string; description: string; className: string } {
  if (accuracy >= 95) return { level: 'A+', description: '优秀', className: 'bg-success-soft text-success' };
  if (accuracy >= 90) return { level: 'A', description: '良好', className: 'bg-success-soft text-success' };
  if (accuracy >= 80) return { level: 'B', description: '中等', className: 'bg-warning-soft text-warning' };
  if (accuracy >= 70) return { level: 'C', description: '及格', className: 'bg-destructive/10 text-destructive' };
  return { level: 'D', description: '需要加强', className: 'bg-destructive/15 text-destructive' };
}

/** 每个词的检查点：刚学写 / 隔词写 / 听写 / 小测；复习词只有一个“复习” */
const CheckpointBadges: React.FC<{ wordState: WordPracticeState }> = ({ wordState }) => (
  <div className="flex flex-wrap gap-1">
    {wordCheckpoints(wordState).map((c) => {
      const meta = STATUS_META[c.status];
      return (
        <span key={c.key} title={checkpointTitle(c)} className={cn('inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[11px]', meta.className)}>
          <meta.icon className="size-3" />
          {c.label}
        </span>
      );
    })}
  </div>
);

const WordList: React.FC<{ title: string; icon: React.ReactNode; words: WordPracticeState[] }> = ({ title, icon, words }) => {
  const valid = words.filter((w) => w?.wordInfo?.word);
  if (valid.length === 0) return null;
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}（{valid.length} 个）
      </h3>
      <div className="grid grid-cols-4 gap-3">
        {valid.map((w) => (
          <Card key={w.wordId} className="gap-2 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-semibold select-text">{w.wordInfo.word}</span>
              {w.isReview && <Badge variant="secondary">复习</Badge>}
            </div>
            <div className="text-sm select-text">{w.wordInfo.meaning || '暂无释义'}</div>
            {w.wordInfo.ipa && <div className="text-xs text-muted-foreground select-text">{w.wordInfo.ipa}</div>}
            <CheckpointBadges wordState={w} />
          </Card>
        ))}
      </div>
    </section>
  );
};

/**
 * 练习结果（shadcn，外壳由 AppShell 提供）：等级与关键数据、详细统计、每个词的检查点、继续学习 / 返回首页。
 * 数据来自路由参数（练习完成时后端返回）。功能清单见 feature-inventory.md §10。
 */
export const PracticeResultPage: React.FC<PracticeResultPageProps> = ({ result, onNavigate }) => {
  const r = result ?? EMPTY_RESULT;
  const g = grade(r.wordAccuracy);

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-8 py-7">
      <Card className="flex-row items-center gap-6 p-6">
        <div className={cn('flex size-20 shrink-0 items-center justify-center rounded-2xl text-3xl font-bold', g.className)}>{g.level}</div>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Trophy className="size-6 text-warning" />
            练习完成！
          </h1>
          <p className="text-muted-foreground">{g.description}</p>
        </div>
        <div className="grid grid-cols-3 gap-8 text-center">
          {[
            { label: '本次通过', value: `${r.passedWords} / ${r.totalWords}` },
            { label: '正确率', value: `${r.wordAccuracy.toFixed(1)}%` },
            { label: '练习时间', value: formatDuration(r.activeTime) },
          ].map((s) => (
            <div key={s.label}>
              <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </Card>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">详细统计</h2>
        <div className="grid grid-cols-6 gap-3">
          <MetricCard label="总单词数" value={r.totalWords} unit="个" />
          <MetricCard label="本次通过" value={r.passedWords} unit="个" icon={Check} hint="新词三步首答全对 / 复习词写对" />
          <MetricCard label="步骤正确率" value={r.stepAccuracy.toFixed(1)} unit="%" icon={Target} />
          <MetricCard label="平均用时" value={Math.round(r.averageTimePerWord / 1000)} unit="秒/词" icon={Clock} />
          <MetricCard label="暂停次数" value={r.pauseCount} unit="次" icon={PauseCircle} />
          <MetricCard label="需要复习" value={r.difficultWords.length} unit="个" icon={TriangleAlert} />
        </div>
      </section>

      <section className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">练习详情</h2>
          <div className="flex gap-3 text-xs text-muted-foreground" aria-label="图例">
            {(
              [
                ['first', '一次就对'],
                ['fixed', '查后改对'],
                ['missed', '没写对'],
              ] as const
            ).map(([status, label]) => {
              const Icon = STATUS_META[status].icon;
              return (
                <span key={status} className="inline-flex items-center gap-1">
                  <span className={cn('flex size-4 items-center justify-center rounded-full', STATUS_META[status].className)}>
                    <Icon className="size-2.5" />
                  </span>
                  {label}
                </span>
              );
            })}
          </div>
        </div>
        <WordList title="本次通过" icon={<Check className="size-4 text-success" />} words={r.passedWordsList ?? []} />
        <WordList title="需要复习" icon={<TriangleAlert className="size-4 text-warning" />} words={r.difficultWords ?? []} />
      </section>

      <div className="flex justify-center gap-3 border-t pt-6">
        <Button variant="outline" onClick={() => onNavigate?.('home')}>
          <Home />
          返回首页
        </Button>
        <Button onClick={() => onNavigate?.('plan-detail', { planId: r.planId })}>
          继续学习
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
};
