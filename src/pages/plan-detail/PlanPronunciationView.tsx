import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { pronunciationService } from '@/services/pronunciationService';
import type { PronunciationOverview, SoundStat } from '@/types/pronunciation';
import { SoundDrillDialog } from './SoundDrillDialog';
import { soundLabel } from '@/utils/pronunciation';

/** 最多列几个音 */
const MAX_SOUNDS = 8;

/**
 * 统计分析里的「发音」：这个计划里跟读的次数、平均分，常读不准的音（读不准的比例高的在前）与读错过的词。
 * 每个音可以「练一练」：读错过的词与只差这个音的成对词（SoundDrillDialog）。还没跟读过时不显示。
 */
export const PlanPronunciationView: React.FC<{ planId: number }> = ({ planId }) => {
  const [data, setData] = useState<PronunciationOverview | null>(null);
  const [drill, setDrill] = useState<SoundStat | null>(null);

  useEffect(() => {
    let stale = false;
    void pronunciationService.overview(planId).then((r) => {
      if (!stale && r.success) setData(r.data);
    });
    return () => {
      stale = true;
    };
  }, [planId]);

  if (!data || data.attempts === 0) return null;
  const sounds = data.sounds.slice(0, MAX_SOUNDS);

  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold">发音</h3>
      <Card className="gap-4 p-5">
        <div className="text-sm text-muted-foreground">
          跟读 <span className="font-medium text-foreground tabular-nums">{data.attempts}</span> 次
          {data.average !== null && (
            <>
              ，平均 <span className="font-medium text-foreground tabular-nums">{data.average}</span> 分
            </>
          )}
        </div>
        {sounds.length > 0 ? (
          <ul className="flex flex-col divide-y">
            {sounds.map((s) => (
              <li key={s.ipa} className="flex items-center gap-4 py-2.5 text-sm">
                <span className="w-14 shrink-0 font-mono text-base font-semibold">{soundLabel(s.ipa)}</span>
                <span className="w-40 shrink-0 text-muted-foreground">
                  {s.times} 次里 {s.weak} 次不准
                  {s.heardAs !== null && <span>，{s.heardAs === '' ? '常没读出来' : `常读成 ${soundLabel(s.heardAs)}`}</span>}
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  {s.words.map((w) => (
                    <span key={w} className="rounded-md bg-muted px-2 py-0.5 font-mono">
                      {w}
                    </span>
                  ))}
                </span>
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => setDrill(s)}>
                  练一练
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-muted-foreground">没有常读不准的音</div>
        )}
      </Card>
      <SoundDrillDialog sound={drill} planId={planId} onClose={() => setDrill(null)} />
    </section>
  );
};
