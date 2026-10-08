import React from 'react';
import { CalendarCheck, Clock, Info, Timer } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Card } from '@/components/ui/card';
import { MetricCard } from '@/components/MetricCard/MetricCard';
import { formatDuration } from '@/utils/datetime';
import { partOfSpeechLabel } from '@/utils/partOfSpeech';
import { memoryBoxLabel } from '@/utils/memoryLevel';
import type { StudyPlanStatistics, StudyPlanWord } from '@/types';

export interface PlanStatisticsViewProps {
  /** 计划统计 */
  statistics: StudyPlanStatistics | null;
  /** 计划单词（带记忆状态） */
  planWords: StudyPlanWord[];
  /** 词性 → 单词数 */
  partOfSpeechStats: { [key: string]: number };
}

/** 一条进度对比条 */
const ProgressRow: React.FC<{ label: string; value: number; barClass: string; tip?: string }> = ({ label, value, barClass, tip }) => (
  <div className="space-y-1.5">
    <div className="flex items-baseline justify-between text-sm">
      <span className="inline-flex items-center gap-1">
        {label}
        {tip && (
          <Tooltip>
            <TooltipTrigger aria-label={`${label}的口径`}>
              <Info className="size-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{tip}</TooltipContent>
          </Tooltip>
        )}
      </span>
      <span className="font-medium tabular-nums">{Math.round(value)}%</span>
    </div>
    <div className="h-2 overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${barClass}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  </div>
);

/**
 * 统计分析：学习投入、进度对比（时间 vs 掌握）、需要加强的单词、词性构成。
 * 正确率、连续学习、已掌握数在页头指标卡里，这里不重复。
 */
export const PlanStatisticsView: React.FC<PlanStatisticsViewProps> = ({ statistics, planWords, partOfSpeechStats }) => {
  const s = statistics;
  const timePct = s?.time_progress_percentage || 0;
  const masteredPct = s?.actual_progress_percentage || 0;
  const tricky = planWords
    .filter((w) => w.lapses > 0)
    .sort((a, b) => b.lapses - a.lapses || a.word.localeCompare(b.word))
    .slice(0, 10);
  const posEntries = Object.entries(partOfSpeechStats).sort((a, b) => b[1] - a[1]);
  const posTotal = posEntries.reduce((n, [, c]) => n + c, 0);

  return (
    <div className="flex flex-col gap-6">
      <section className="space-y-3">
        <h3 className="text-base font-semibold">学习投入</h3>
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="累计练习时长" value={formatDuration((s?.total_study_minutes || 0) * 60_000)} icon={Timer} tip="不含暂停的时间" />
          <MetricCard label="平均每个学习日" value={s?.average_daily_study_minutes || 0} unit="分钟" icon={Clock} />
          <MetricCard
            label="练完的学习日"
            value={`${s?.completed_days || 0} / ${s?.total_days || 0}`}
            unit="天"
            icon={CalendarCheck}
            hint={s && s.overdue_days > 0 ? <span className="text-warning">{s.overdue_days} 天没补</span> : undefined}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-semibold">进度对比</h3>
        <Card className="gap-5 p-5">
          <ProgressRow label="时间进度" value={timePct} barClass="bg-muted-foreground/40" tip="计划周期已经过去的比例" />
          <ProgressRow label="单词掌握" value={masteredPct} barClass="bg-chart-2" tip="间隔 7 天后仍能写对的单词占比" />
          {timePct >= 100 && masteredPct < 100 ? (
            <p className="text-sm text-warning">计划周期已结束，还有单词没掌握</p>
          ) : null}
        </Card>
      </section>

      <div className="grid grid-cols-2 gap-6">
        <section className="space-y-3">
          <h3 className="text-base font-semibold">需要加强的单词</h3>
          <Card className="gap-0 divide-y py-0">
            {tricky.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">还没有复习时写错的单词</p>
            ) : (
              tricky.map((w) => (
                <div key={w.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium select-text">{w.word}</span>
                    <span className="ml-2 truncate text-muted-foreground">{w.meaning}</span>
                  </div>
                  <div className="shrink-0 text-right text-xs">
                    <div className="text-destructive tabular-nums">答错 {w.lapses} 次</div>
                    <div className="text-muted-foreground">{memoryBoxLabel(w.memory_box)}</div>
                  </div>
                </div>
              ))
            )}
          </Card>
        </section>

        <section className="space-y-3">
          <h3 className="text-base font-semibold">词性构成</h3>
          <Card className="gap-3 p-5">
            {posEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无单词</p>
            ) : (
              posEntries.map(([pos, count]) => (
                <div key={pos} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{partOfSpeechLabel(pos)}</span>
                    <span className="tabular-nums text-muted-foreground">{count} 个</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-chart-1" style={{ width: `${posTotal > 0 ? (count / posTotal) * 100 : 0}%` }} />
                  </div>
                </div>
              ))
            )}
          </Card>
        </section>
      </div>
    </div>
  );
};
