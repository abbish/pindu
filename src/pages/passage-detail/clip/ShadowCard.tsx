import React from 'react';
import { Headphones } from 'lucide-react';
import type { SentenceStripProps } from './SentenceStrip';
import { PracticeCard, type PracticeControls } from './PracticeCard';

export interface ShadowCardProps {
  /** 这一段第一句（进度条上标出） */
  unitStart: number;
  /** 第几段（从 0 开始）与一共几段 */
  unitIndex: number;
  unitCount: number;
  strip: SentenceStripProps['items'];
  /** 点进度条上的一句：去它所在的那段 */
  onPick: (index: number) => void;
  onUnit: (unitIndex: number) => void;
  controls: PracticeControls;
  /** 跟读时的状态（准备… / 跟着原声说 / 正在评估…） */
  status?: string;
  /** 这一段的台词（ClipSentences：和原文页签同样的显示，结果在每句下面） */
  sentences: React.ReactNode;
  notice?: React.ReactNode;
  error?: string | null;
}

/**
 * 影子跟读：和逐句跟读同一个外壳，一次练一段（约 30 秒的几句）。戴上耳机，按「跟读」后原声连着放、同时录你说，
 * 放完逐句看跟上了几个词、比原声慢多少。
 */
export const ShadowCard: React.FC<ShadowCardProps> = (p) => (
  <PracticeCard
    position={`第 ${p.unitIndex + 1} / ${p.unitCount} 段`}
    strip={p.strip}
    stripCurrent={p.unitStart}
    onPick={p.onPick}
    status={p.status}
    controls={p.controls}
    prevLabel="上一段"
    nextLabel="下一段"
    onPrev={p.unitIndex > 0 ? () => p.onUnit(p.unitIndex - 1) : undefined}
    onNext={p.unitIndex + 1 < p.unitCount ? () => p.onUnit(p.unitIndex + 1) : undefined}
  >
    {p.notice}
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Headphones className="size-3.5" />
      戴上耳机，看着台词和原声同时说
    </p>
    {p.sentences}
    {p.error && <p className="text-sm text-destructive">{p.error}</p>}
  </PracticeCard>
);
