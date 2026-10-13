import React, { useEffect, useState } from 'react';
import { BookOpen, CalendarCheck, Clock, Headphones, Info, Target, Timer } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Card } from '@/components/ui/card';
import { MetricCard } from '@/components/MetricCard/MetricCard';
import { formatDuration } from '@/utils/datetime';
import { partOfSpeechLabel } from '@/utils/partOfSpeech';
import { memoryBoxLabel } from '@/utils/memoryLevel';
import { passageService } from '@/services/passageService';
import type { PassageStatistics } from '@/types/passage';
import type { StudyPlanStatistics, StudyPlanWord } from '@/types';
import { PlanPronunciationView } from './PlanPronunciationView';

export interface PlanStatisticsViewProps {
  planId: number;
  /** 计划统计 */
  statistics: StudyPlanStatistics | null;
  /** 计划单词（带记忆状态） */
  planWords: StudyPlanWord[];
  /** 词性 → 单词数 */
  partOfSpeechStats: { [key: string]: number };
  /** 时间进度 %（与页头进度条同一口径） */
  timeProgress: number;
  /** 计划练单词 / 练短文 */
  withWords: boolean;
  withPassages: boolean;
  /** 计划里完成的短文 / 全部短文 */
  completedPassages: number;
  totalPassages: number;
}

const KIND_LABEL: Record<string, string> = { cloze: '选词填空', choice: '选择', true_false: '判断', open: '开放题' };

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

const percent = (v: number | null | undefined) => (v == null ? '—' : Math.round(v));

/**
 * 统计分析：学习投入、进度对比，然后按能力分三块——拼写（一次答对率、需要加强的单词、词性构成）、
 * 发音（跟读）、阅读和听力（计划里的短文作答，按题型）。没有对应内容的块不显示。
 */
export const PlanStatisticsView: React.FC<PlanStatisticsViewProps> = ({ planId, statistics, planWords, partOfSpeechStats, timeProgress, withWords, withPassages, completedPassages, totalPassages }) => {
  const s = statistics;
  const [passageStats, setPassageStats] = useState<PassageStatistics | null>(null);
  useEffect(() => {
    if (!withPassages) return;
    let stale = false;
    void passageService.getStatistics(planId).then((r) => {
      if (!stale && r.success) setPassageStats(r.data);
    });
    return () => {
      stale = true;
    };
  }, [planId, withPassages]);

  const total = s?.total_words || 0;
  const learnedPct = total > 0 ? ((s?.learned_words || 0) / total) * 100 : 0;
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
          <MetricCard label="累计练习时长" value={formatDuration(s?.total_active_ms || 0)} icon={Timer} tip="单词练习和短文作答，不含暂停的时间" />
          <MetricCard label="平均每个学习日" value={formatDuration(s?.average_daily_active_ms || 0)} icon={Clock} />
          <MetricCard
            label="练完的日子"
            value={`${s?.completed_days || 0} / ${s?.task_days || 0}`}
            unit="天"
            icon={CalendarCheck}
            tip="有任务的日子里，当天的单词和短文都完成的天数；巩固期的复习到当天才安排"
            hint={s && s.overdue_days > 0 ? <span className="text-warning">没练 {s.overdue_days} 天</span> : undefined}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-semibold">进度对比</h3>
        <Card className="gap-5 p-5">
          <ProgressRow label="时间进度" value={timeProgress} barClass="bg-muted-foreground/40" tip="计划周期（含巩固期）已经过去的比例" />
          {withWords && <ProgressRow label="已学" value={learnedPct} barClass="bg-brand/40" tip="练过一次的单词占比" />}
          {withWords && <ProgressRow label="已掌握" value={masteredPct} barClass="bg-brand" tip="间隔 7 天后仍能写对的单词占比；全部掌握后计划自动完成" />}
          {withPassages && (
            <ProgressRow label="短文" value={totalPassages > 0 ? (completedPassages / totalPassages) * 100 : 0} barClass="bg-chart-2" tip="完成的短文占比" />
          )}
          {withWords && timeProgress >= 100 && masteredPct < 100 ? <p className="text-sm text-warning">计划周期已结束，还有单词没掌握</p> : null}
        </Card>
      </section>

      {withWords && (
        <section className="space-y-3">
          <h3 className="text-base font-semibold">拼写</h3>
          <div className="grid grid-cols-3 gap-3">
            <MetricCard
              label="一次答对率"
              value={(s?.learned_words || 0) > 0 ? Math.round(s?.average_accuracy_rate || 0) : '—'}
              unit="%"
              icon={Target}
              tip="每一步第一次作答就写对的比例"
            />
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">需要加强的单词</h4>
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
            </div>
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">词性构成</h4>
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
            </div>
          </div>
        </section>
      )}

      <PlanPronunciationView planId={planId} />

      {withPassages && passageStats && passageStats.reading.attempts + passageStats.listening.attempts > 0 && (
        <section className="space-y-3">
          <h3 className="text-base font-semibold">阅读和听力</h3>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['阅读', BookOpen, passageStats.reading],
                ['听力', Headphones, passageStats.listening],
              ] as const
            ).map(([label, icon, m]) => (
              <MetricCard
                key={label}
                label={`${label}客观题答对率`}
                value={m.attempts > 0 ? percent(m.objectiveAccuracy) : '—'}
                unit={m.attempts > 0 && m.objectiveAccuracy != null ? '%' : undefined}
                icon={icon}
                hint={m.attempts > 0 ? `做了 ${m.attempts} 次${m.openScoreRate != null ? ` · 开放题得分率 ${Math.round(m.openScoreRate)}%` : ''}` : '还没做过'}
              />
            ))}
          </div>
          {passageStats.byKind.length > 0 && (
            <Card className="gap-3 p-5">
              {passageStats.byKind.map((k) => (
                <div key={k.kind} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{KIND_LABEL[k.kind] ?? k.kind}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {k.answered} 题 · {k.kind === 'open' ? '得分率' : '答对'} {Math.round(k.rate)}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-chart-2" style={{ width: `${Math.min(100, Math.max(0, k.rate))}%` }} />
                  </div>
                </div>
              ))}
            </Card>
          )}
        </section>
      )}
    </div>
  );
};
